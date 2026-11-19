import { PGlite } from "@electric-sql/pglite";
import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@db/schema";
import { listings } from "@fixtures/listings";
import { migrate } from "@/lib/db/migrate";

import type { Issue, Review, Severity } from "./rules";
import { createReviewStore, decodeCursor, QUEUE_PAGE_SIZE, type ReviewStore } from "./store";

/** Kysely over an in-memory PGlite, as in src/lib/db/migrate.test.ts. */
function kyselyOver(pglite: PGlite): Kysely<Database> {
  const client = {
    query: async (text: string, params: unknown[]) => {
      const result = await pglite.query(text, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
    },
    release() {},
  };
  const pool = { connect: async () => client, end: async () => {} };
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: pool as unknown as Pool }) });
}

function issue(severity: Severity, rule = "2.3"): Issue {
  return { code: `test_${severity}`, rule, severity, message: `a ${severity} finding` };
}

/** 120 listings in submission order; every 7th is reject, every 5th fix, every 3rd warn, the rest pass. */
const reviews: Review[] = listings.slice(0, 120).map((listing, i) => {
  const issues: Issue[] = [];
  if (i % 7 === 0) issues.push(issue("reject", "6.2"));
  else if (i % 5 === 0) issues.push(issue("fix"));
  else if (i % 3 === 0) issues.push(issue("warn", "1.6"));
  return { listing, issues };
});

const RANK: Record<string, number> = { reject: 0, fix: 1, warn: 2, none: 3 };
const rankOf = (r: Review) => RANK[r.issues[0]?.severity ?? "none"]!;

/** What the whole queue should look like: worst first, then submission order. */
const expectedOrder = reviews
  .map((review, order) => ({ review, order }))
  .sort((a, b) => rankOf(a.review) - rankOf(b.review) || a.order - b.order)
  .map(({ review }) => review.listing.uuid);

describe("review store", () => {
  let pglite: PGlite;
  let db: Kysely<Database>;
  let store: ReviewStore;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    db = kyselyOver(pglite);
    await migrate(db);
    store = createReviewStore(db);
    await store.saveReviews(reviews, "3");
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("pages 50 at a time, most serious first across every page", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await store.getQueuePage({ after: cursor });
      expect(page.size).toBe(QUEUE_PAGE_SIZE);
      expect(page.total).toBe(120);
      seen.push(...page.rows.map((row) => row.listing.uuid));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual(expectedOrder);
  });

  it("walks back with the previous cursor to the same rows", async () => {
    const first = await store.getQueuePage();
    expect(first.prevCursor).toBeNull();
    const second = await store.getQueuePage({ after: first.nextCursor });
    const back = await store.getQueuePage({ before: second.prevCursor });

    expect(back.rows.map((row) => row.listing.uuid)).toEqual(first.rows.map((row) => row.listing.uuid));
    expect(back.prevCursor).toBeNull();
    expect(back.nextCursor).toBe(first.nextCursor);
  });

  it("caps the page size at 50 and treats a bad cursor as the first page", async () => {
    expect((await store.getQueuePage({ size: 500 })).rows).toHaveLength(QUEUE_PAGE_SIZE);
    expect((await store.getQueuePage({ size: 10 })).rows).toHaveLength(10);
    expect(decodeCursor("not-a-cursor")).toBeNull();
    const bad = await store.getQueuePage({ after: "not-a-cursor" });
    expect(bad.rows[0]?.listing.uuid).toBe(expectedOrder[0]);
  });

  it("filters by worst severity and by rule", async () => {
    const passed = await store.getQueuePage({ severity: "none" });
    expect(passed.total).toBe(reviews.filter((r) => r.issues.length === 0).length);
    expect(passed.rows.every((row) => row.issues.length === 0)).toBe(true);

    const urlRule = await store.getQueuePage({ rule: "6.2" });
    expect(urlRule.total).toBe(reviews.filter((r) => r.issues.some((i) => i.rule === "6.2")).length);
  });

  it("counts listings by worst severity", async () => {
    const counts = await store.getSeverityCounts();
    const count = (rank: number) => reviews.filter((r) => rankOf(r) === rank).length;
    expect(counts).toEqual({ reject: count(0), fix: count(1), warn: count(2), none: count(3) });
  });

  it("returns one stored review with its revision, or null when the job has not reached it", async () => {
    const stored = await store.getReview(reviews[3]!.listing.uuid);
    expect(stored?.issues).toEqual(reviews[3]!.issues);
    expect(stored?.ruleRevision).toBe("3");

    expect(await store.getReview("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("replaces a listing's review when saved again", async () => {
    const updated = reviews.map((review, i) => (i === 1 ? { ...review, issues: [issue("reject", "6.2")] } : review));
    await store.saveReviews(updated, "3");

    const first = await store.getQueuePage({ size: 1 });
    expect(first.rows[0]?.listing.uuid).toBe(reviews[0]!.listing.uuid);
    const second = await store.getQueuePage({ size: 1, after: first.nextCursor });
    expect(second.rows[0]?.listing.uuid).toBe(reviews[1]!.listing.uuid);
  });
});
