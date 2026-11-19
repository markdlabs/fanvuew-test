import Link from "next/link";

import { worstSeverity } from "@/lib/moderation/queue";
import type { Severity } from "@/lib/moderation/rules";
import type { QueueFilter, QueuePage, SeverityCounts } from "@/lib/moderation/store";

import { SeverityBadge, STATUS_LABEL } from "./SeverityBadge";

type Status = Severity | "none";
const STATUSES: Status[] = ["reject", "fix", "warn", "none"];

/** Builds a queue URL that keeps the current size and filters. */
function queueHref(filter: QueueFilter, change: Partial<QueueFilter>): string {
  const next = { ...filter, ...change };
  const params = new URLSearchParams();
  if (next.severity) params.set("severity", next.severity);
  if (next.rule) params.set("rule", next.rule);
  if (next.size) params.set("size", String(next.size));
  if (next.after) params.set("after", next.after);
  else if (next.before) params.set("before", next.before);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

/**
 * The moderator's queue: one page of stored reviews, most serious first across
 * every page. Every row here was reviewed; a listing the job has not reached
 * has no row, and the header says what the last run covered.
 */
export function ReviewQueue({
  page,
  counts,
  filter,
}: {
  page: QueuePage;
  counts: SeverityCounts;
  filter: QueueFilter;
}) {
  const reviewed = counts.reject + counts.fix + counts.warn + counts.none;
  const flagged = reviewed - counts.none;
  const firstPage = !page.prevCursor;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Review queue</h1>
        {page.reviewedAt ? (
          <p className="text-sm text-neutral-600">
            Last review run {formatTime(page.reviewedAt)} · Listing Requirements revision {page.ruleRevision}
          </p>
        ) : (
          <p className="text-sm font-medium text-red-700">
            The review job has not run yet. Run <code>npm run review</code> to fill the queue.
          </p>
        )}
      </div>

      {page.reviewedAt && (
        <p className="text-sm">
          {reviewed.toLocaleString()} listings reviewed: <strong>{flagged.toLocaleString()} need attention</strong>,{" "}
          {counts.none.toLocaleString()} passed every rule. Listings submitted since the last run are not reviewed yet
          and appear after the next run.
        </p>
      )}

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filter by status">
        <FilterLink href={queueHref(filter, { severity: undefined, after: null, before: null })} active={!filter.severity}>
          All ({reviewed.toLocaleString()})
        </FilterLink>
        {STATUSES.map((status) => (
          <FilterLink
            key={status}
            href={queueHref(filter, { severity: status, after: null, before: null })}
            active={filter.severity === status}
          >
            {STATUS_LABEL[status]} ({counts[status].toLocaleString()})
          </FilterLink>
        ))}
        {filter.rule && (
          <FilterLink href={queueHref(filter, { rule: undefined, after: null, before: null })} active>
            Rule {filter.rule} ✕
          </FilterLink>
        )}
      </nav>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">App</th>
            <th className="py-2 pr-4">Developer</th>
            <th className="py-2 pr-4">Findings</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-neutral-500">
                {page.reviewedAt ? "No listings match this filter." : "Nothing reviewed yet."}
              </td>
            </tr>
          )}
          {page.rows.map(({ listing, issues }) => (
            <tr key={listing.uuid} className="border-b align-top">
              <td className="py-2 pr-4">
                <SeverityBadge severity={worstSeverity(issues) ?? "none"} />
              </td>
              <td className="py-2 pr-4">
                <Link href={`/listings/${listing.uuid}`} className="underline">
                  {listing.name}
                </Link>
              </td>
              <td className="py-2 pr-4">{listing.developer.handle ? `@${listing.developer.handle}` : "-"}</td>
              <td className="py-2 pr-4">
                {issues.length === 0 ? (
                  <span className="text-neutral-500">None</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {issues.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>
                        <Link
                          href={queueHref(filter, { rule: issue.rule, after: null, before: null })}
                          className="font-mono text-xs underline"
                          title={`Show only rule ${issue.rule}`}
                        >
                          {issue.rule}
                        </Link>{" "}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
        <span className="text-neutral-600">
          {page.total.toLocaleString()} matching · {page.size} per page
        </span>
        <span className="flex gap-4">
          {!firstPage && (
            <Link href={queueHref(filter, { after: null, before: null })} className="underline">
              First
            </Link>
          )}
          {page.prevCursor ? (
            <Link href={queueHref(filter, { after: null, before: page.prevCursor })} className="underline">
              ← Previous
            </Link>
          ) : (
            <span className="text-neutral-400">← Previous</span>
          )}
          {page.nextCursor ? (
            <Link href={queueHref(filter, { after: page.nextCursor, before: null })} className="underline">
              Next →
            </Link>
          ) : (
            <span className="text-neutral-400">Next →</span>
          )}
        </span>
      </nav>
    </section>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded border px-2 py-1 no-underline ${active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
