import type { Generated, JSONColumnType } from "kysely";

import type { AppListing } from "@/lib/fanvue/types";
import type { Issue } from "@/lib/moderation/rules";

/**
 * The tables in the moderation database, as Kysely sees them. Each key is a
 * table name and each value describes its columns. Add a table here when you
 * add a migration for it, and `getDb()` knows about it.
 *
 * `Generated<T>` marks a column the database fills in, so inserts can leave
 * it out. `JSONColumnType<T>`, also from `kysely`, is for a `jsonb` column:
 * insert `JSON.stringify(value)` and read it back as `T`.
 */
export interface Database {
  review_runs: ReviewRunsTable;
  reviews: ReviewsTable;
}

/** One row per run of the review job. The worked example. */
export interface ReviewRunsTable {
  id: Generated<number>;
  started_at: Generated<Date>;
  finished_at: Date | null;
  rule_revision: string;
  listing_count: number | null;
}

/** One row per listing: its latest stored review. See `db/migrations/0002_reviews.ts`. */
export interface ReviewsTable {
  uuid: string;
  submission_order: number;
  /** 0 = reject, 1 = fix, 2 = warn, 3 = none. */
  worst_severity_rank: number;
  rules: Generated<string[]>;
  listing: JSONColumnType<AppListing>;
  issues: JSONColumnType<Issue[]>;
  rule_revision: string;
  reviewed_at: Generated<Date>;
}
