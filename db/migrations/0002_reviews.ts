import { type Kysely, sql } from "kysely";

// One row per listing: the latest stored review of it.
//
// The queue sorts by `worst_severity_rank` then `submission_order`, with
// `uuid` as the final tiebreak so the order is total. That triple is also the
// keyset cursor, and `reviews_queue_idx` serves both the sort and the seek.
//
// Severity lives inside `issues` (jsonb), which cannot be sorted or indexed
// well, so the job writes the derived rank alongside it:
//   0 = reject, 1 = fix, 2 = warn, 3 = none (every rule passed).
// A listing the job has not reached has no row at all.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("reviews")
    .addColumn("uuid", "text", (col) => col.primaryKey())
    // Position in `GET /apps` order when the job fetched it.
    .addColumn("submission_order", "integer", (col) => col.notNull())
    .addColumn("worst_severity_rank", "smallint", (col) => col.notNull())
    // Rule numbers that fired, e.g. {"2.3","6.2"}, for the rule filter.
    .addColumn("rules", sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn("listing", "jsonb", (col) => col.notNull())
    .addColumn("issues", "jsonb", (col) => col.notNull())
    // Revision of docs/listing-requirements.md these findings were made under.
    .addColumn("rule_revision", "text", (col) => col.notNull())
    .addColumn("reviewed_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("reviews_queue_idx")
    .on("reviews")
    .columns(["worst_severity_rank", "submission_order", "uuid"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("reviews").execute();
}
