import { ReviewQueue } from "@/components/ReviewQueue";
import type { Severity } from "@/lib/moderation/rules";
import { createReviewStore, type QueueFilter } from "@/lib/moderation/store";

// Reads the store on every request; no API calls, so that is cheap.
export const dynamic = "force-dynamic";

const STATUSES = new Set<string>(["reject", "fix", "warn", "none"]);

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Turns the URL into a queue filter, ignoring anything it does not recognise. */
function parseFilter(params: SearchParams): QueueFilter {
  const size = Number(one(params.size));
  const severity = one(params.severity);
  const rule = one(params.rule);
  return {
    size: Number.isFinite(size) && size > 0 ? size : undefined,
    after: one(params.after) ?? null,
    before: one(params.before) ?? null,
    severity: severity && STATUSES.has(severity) ? (severity as Severity | "none") : undefined,
    rule: rule && /^\d+\.\d+$/.test(rule) ? rule : undefined,
  };
}

/**
 * The queue: one page of stored reviews, most serious first across every page.
 * The URL carries the cursor (`after` / `before`), the page size and filters.
 */
export default async function ReviewQueuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filter = parseFilter(await searchParams);
  const store = createReviewStore();

  const startedAt = performance.now();
  const [page, counts] = await Promise.all([store.getQueuePage(filter), store.getSeverityCounts()]);
  const ms = Math.round(performance.now() - startedAt);

  return (
    <>
      <ReviewQueue page={page} counts={counts} filter={{ ...filter, size: filter.size ? page.size : undefined }} />
      <p className="mt-6 text-xs text-neutral-500">
        Read from the review store in {ms.toLocaleString()} ms. This page made no API calls.
      </p>
    </>
  );
}
