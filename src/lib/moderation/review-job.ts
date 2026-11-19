import { getDb } from "@/lib/db/client";
import { getApp, LIVE_RATE_LIMIT_PER_MINUTE, listApps, MAX_PAGE_SIZE } from "@/lib/fanvue/api";
import type { AppListing } from "@/lib/fanvue/types";

import { createRateLimiter, type RateLimiter } from "./rate-limit";
import { reviewListings, RULE_REVISION } from "./rules";
import { createReviewStore } from "./store";

/**
 * Fetches every listing the slow way: each list page, then one detail call per
 * listing. Fine for a job, but too slow for a page load.
 *
 * Pass a `limiter` to stay under the live API's rate limit. Every list and
 * detail call waits on it first. `onPage` is called after each list page and
 * its details are fetched, so a long run can report progress.
 */
export async function fetchEveryListing({
  limiter,
  onPage,
}: {
  limiter?: RateLimiter;
  onPage?: (progress: { page: number; listings: number; apiCalls: number; ms: number }) => void;
} = {}): Promise<{
  listings: AppListing[];
  apiCalls: number;
  ms: number;
}> {
  const startedAt = performance.now();
  const throttle = () => limiter?.acquire() ?? Promise.resolve();

  const listings: AppListing[] = [];
  let apiCalls = 0;
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    await throttle();
    const result = await listApps({ page, size: MAX_PAGE_SIZE });
    apiCalls += 1;
    for (const summary of result.data) {
      await throttle();
      const listing = await getApp(summary.uuid);
      apiCalls += 1;
      if (listing) listings.push(listing);
    }
    onPage?.({ page, listings: listings.length, apiCalls, ms: Math.round(performance.now() - startedAt) });
    hasMore = result.pagination.hasMore;
    page += 1;
  }

  return { listings, apiCalls, ms: Math.round(performance.now() - startedAt) };
}

/** 41 list calls and 2,015 detail calls (README, "The task"). Only used for the progress ETA. */
const EXPECTED_API_CALLS = 41 + 2_015;

/**
 * Calls a minute the job allows itself. Defaults to the live API's limit.
 * Raise it with `REVIEW_RATE_LIMIT_PER_MINUTE` when running against the mock,
 * which does not enforce a limit.
 */
function rateLimitPerMinute(): number {
  const raw = process.env.REVIEW_RATE_LIMIT_PER_MINUTE;
  if (!raw) return LIVE_RATE_LIMIT_PER_MINUTE;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`REVIEW_RATE_LIMIT_PER_MINUTE must be a positive number, got "${raw}"`);
  }
  return value;
}

/**
 * The job: fetch every listing, review, store. `npm run review` runs it.
 *
 * It records a `review_runs` row first and marks it finished only after the
 * reviews are saved, so a failed run never becomes the run the queue shows.
 */
export async function runReviewJob(): Promise<void> {
  const db = getDb();
  const perMinute = rateLimitPerMinute();

  const run = await db
    .insertInto("review_runs")
    .values({ rule_revision: RULE_REVISION })
    .returning("id")
    .executeTakeFirstOrThrow();

  console.log(`review run ${run.id}: requirements revision ${RULE_REVISION}, at most ${perMinute} API calls a minute`);

  const { listings, apiCalls, ms } = await fetchEveryListing({
    limiter: createRateLimiter({ perMinute }),
    onPage: (progress) => {
      // The API does not say how many listings there are, so the ETA assumes
      // the last known total; it only steers the "how long" guess, not the run.
      const remainingCalls = Math.max(0, EXPECTED_API_CALLS - progress.apiCalls);
      const etaSeconds = Math.ceil((remainingCalls / perMinute) * 60);
      console.log(
        `  page ${progress.page}: ${progress.listings} listings, ${progress.apiCalls} calls, ` +
          `${Math.round(progress.ms / 1000)} s elapsed, ~${etaSeconds} s left at ${perMinute}/min`,
      );
    },
  });
  console.log(`fetched ${listings.length} listings with ${apiCalls} API calls in ${ms} ms`);

  const reviews = reviewListings(listings);
  await createReviewStore(db).saveReviews(reviews, RULE_REVISION);

  await db
    .updateTable("review_runs")
    .set({ finished_at: new Date(), listing_count: reviews.length })
    .where("id", "=", run.id)
    .execute();

  const flagged = reviews.filter((review) => review.issues.length > 0).length;
  console.log(`saved ${reviews.length} reviews, ${flagged} with findings`);
}
