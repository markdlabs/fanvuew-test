import { type Kysely, sql } from "kysely";

import type { Database } from "@db/schema";
import { getDb } from "@/lib/db/client";

import { SEVERITY_ORDER, worstSeverity } from "./queue";
import type { Review, Severity } from "./rules";

/**
 * The index the queue reads: reviews the job wrote, sorted by severity, a page
 * at a time, with keyset (cursor) pagination.
 *
 * Order: worst severity first (reject, fix, warn, then none), then submission
 * order, then uuid so the order is total. That triple is the cursor, and
 * `reviews_queue_idx` (db/migrations/0002_reviews.ts) serves the seek, so a
 * deep page costs the same as the first.
 */

/** Rows per page. The queue shows 50 at a time, and never more. */
export const QUEUE_PAGE_SIZE = 50;

/** How many rows go in one insert statement while saving. */
const SAVE_BATCH_SIZE = 50;

export type QueueFilter = {
  /** 1..QUEUE_PAGE_SIZE. Defaults to QUEUE_PAGE_SIZE. */
  size?: number;
  /** Rows after this cursor (the next page). */
  after?: string | null;
  /** Rows before this cursor (the previous page). Ignored when `after` is set. */
  before?: string | null;
  /** Worst severity on the listing, or `"none"` for listings every rule passed. */
  severity?: Severity | "none";
  /** A rule number such as `"3.3"`. */
  rule?: string;
};

/** A review as stored: the findings plus when and under which revision they were made. */
export type StoredReview = Review & {
  ruleRevision: string;
  reviewedAt: string;
};

export type QueuePage = {
  rows: StoredReview[];
  /** Rows matching the filter across every page. */
  total: number;
  size: number;
  /** Cursor for the next page, or `null` on the last page. */
  nextCursor: string | null;
  /** Cursor for the previous page, or `null` on the first page. */
  prevCursor: string | null;
  /** When the job last finished, or `null` if it never has. The queue shows this. */
  reviewedAt: string | null;
  /** The revision of `docs/listing-requirements.md` the last run used. */
  ruleRevision: string | null;
};

export type ReviewStore = {
  /**
   * Replaces what is stored for each listing in `reviews`. `reviews` must be in
   * submission order: a review's position is stored as its submission order.
   * The job always saves the whole set, because 4.2 makes every review depend
   * on every listing.
   */
  saveReviews(reviews: Review[], ruleRevision: string): Promise<void>;
  /** One listing's stored review, or `null` if the job has not reached it. */
  getReview(uuid: string): Promise<StoredReview | null>;
  /** Rows matching the filter, most serious first. Rows with the same severity keep submission order. */
  getQueuePage(filter?: QueueFilter): Promise<QueuePage>;
  /** How many stored listings have each worst severity. `none` = every rule passed. */
  getSeverityCounts(): Promise<SeverityCounts>;
};

export type SeverityCounts = Record<Severity | "none", number>;

/** 0 = reject, 1 = fix, 2 = warn, 3 = none. */
export function severityRank(severity: Severity | "none" | null): number {
  if (severity === null || severity === "none") return SEVERITY_ORDER.length;
  return SEVERITY_ORDER.indexOf(severity);
}

type CursorKey = { rank: number; order: number; uuid: string };

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify([key.rank, key.order, key.uuid])).toString("base64url");
}

/** `null` for anything that is not a cursor this store made, so a bad URL shows the first page. */
export function decodeCursor(cursor: string | null | undefined): CursorKey | null {
  if (!cursor) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [rank, order, uuid] = value as unknown[];
    if (typeof rank !== "number" || typeof order !== "number" || typeof uuid !== "string") return null;
    return { rank, order, uuid };
  } catch {
    return null;
  }
}

function clampSize(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size)) return QUEUE_PAGE_SIZE;
  return Math.min(QUEUE_PAGE_SIZE, Math.max(1, Math.trunc(size)));
}

export function createReviewStore(db: Kysely<Database> = getDb()): ReviewStore {
  return {
    async saveReviews(reviews, ruleRevision) {
      const rows = reviews.map((review, index) => ({
        uuid: review.listing.uuid,
        submission_order: index,
        worst_severity_rank: severityRank(worstSeverity(review.issues)),
        rules: [...new Set(review.issues.map((issue) => issue.rule))].sort(),
        listing: JSON.stringify(review.listing),
        issues: JSON.stringify(review.issues),
        rule_revision: ruleRevision,
      }));

      // One transaction, so the queue never shows half an old run and half a new one.
      // PGlite makes other connections wait while it is open, so it only holds the inserts.
      await db.transaction().execute(async (trx) => {
        for (let i = 0; i < rows.length; i += SAVE_BATCH_SIZE) {
          await trx
            .insertInto("reviews")
            .values(rows.slice(i, i + SAVE_BATCH_SIZE))
            .onConflict((oc) =>
              oc.column("uuid").doUpdateSet((eb) => ({
                submission_order: eb.ref("excluded.submission_order"),
                worst_severity_rank: eb.ref("excluded.worst_severity_rank"),
                rules: eb.ref("excluded.rules"),
                listing: eb.ref("excluded.listing"),
                issues: eb.ref("excluded.issues"),
                rule_revision: eb.ref("excluded.rule_revision"),
                reviewed_at: sql<Date>`now()`,
              })),
            )
            .execute();
        }
      });
    },

    async getReview(uuid) {
      const row = await db
        .selectFrom("reviews")
        .select(["listing", "issues", "rule_revision", "reviewed_at"])
        .where("uuid", "=", uuid)
        .executeTakeFirst();
      if (!row) return null;
      return {
        listing: row.listing,
        issues: row.issues,
        ruleRevision: row.rule_revision,
        reviewedAt: new Date(row.reviewed_at).toISOString(),
      };
    },

    async getQueuePage(filter = {}) {
      const size = clampSize(filter.size);
      const after = decodeCursor(filter.after);
      const before = after ? null : decodeCursor(filter.before);

      let base = db.selectFrom("reviews");
      if (filter.severity) base = base.where("worst_severity_rank", "=", severityRank(filter.severity));
      if (filter.rule) base = base.where(sql<boolean>`rules @> array[${filter.rule}]::text[]`);

      const key = sql`(worst_severity_rank, submission_order, uuid)`;
      let query = base.select(["uuid", "submission_order", "worst_severity_rank", "listing", "issues", "rule_revision", "reviewed_at"]);
      if (after) query = query.where(sql<boolean>`${key} > (${after.rank}, ${after.order}, ${after.uuid})`);
      if (before) query = query.where(sql<boolean>`${key} < (${before.rank}, ${before.order}, ${before.uuid})`);

      const direction = before ? "desc" : "asc";
      // One extra row tells us whether there is another page in this direction.
      const fetched = await query
        .orderBy("worst_severity_rank", direction)
        .orderBy("submission_order", direction)
        .orderBy("uuid", direction)
        .limit(size + 1)
        .execute();

      const hasMore = fetched.length > size;
      const page = fetched.slice(0, size);
      if (before) page.reverse();

      const cursorOf = (row: (typeof page)[number]) =>
        encodeCursor({ rank: row.worst_severity_rank, order: row.submission_order, uuid: row.uuid });
      const first = page[0];
      const last = page[page.length - 1];

      // Going forward: there is a previous page whenever we came from a cursor.
      // Going back: there is a next page, because we came from one.
      const nextCursor = last && (before ? true : hasMore) ? cursorOf(last) : null;
      const prevCursor = first && (before ? hasMore : after !== null) ? cursorOf(first) : null;

      const [{ total }, lastRun] = await Promise.all([
        base.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow(),
        db
          .selectFrom("review_runs")
          .select(["finished_at", "rule_revision"])
          .where("finished_at", "is not", null)
          .orderBy("finished_at", "desc")
          .limit(1)
          .executeTakeFirst(),
      ]);

      return {
        rows: page.map((row) => ({
          listing: row.listing,
          issues: row.issues,
          ruleRevision: row.rule_revision,
          reviewedAt: new Date(row.reviewed_at).toISOString(),
        })),
        total,
        size,
        nextCursor,
        prevCursor,
        reviewedAt: lastRun?.finished_at ? new Date(lastRun.finished_at).toISOString() : null,
        ruleRevision: lastRun?.rule_revision ?? null,
      };
    },

    async getSeverityCounts() {
      const rows = await db
        .selectFrom("reviews")
        .select(["worst_severity_rank", sql<number>`count(*)::int`.as("count")])
        .groupBy("worst_severity_rank")
        .execute();

      const counts: SeverityCounts = { reject: 0, fix: 0, warn: 0, none: 0 };
      for (const row of rows) {
        const severity = SEVERITY_ORDER[row.worst_severity_rank] ?? "none";
        counts[severity] = row.count;
      }
      return counts;
    },
  };
}
