import { SEVERITY_ORDER } from "@/lib/moderation/queue";
import type { Issue } from "@/lib/moderation/rules";

import { SeverityBadge } from "./SeverityBadge";

/** Anchors in docs/listing-requirements.md, so a moderator can read the rule itself. */
const RULE_ANCHOR: Record<string, string> = {
  "1.6": "16-no-promotion-of-other-platforms",
  "2.1": "21-production-ready",
  "2.3": "23-listing-quality",
  "3.3": "33-pricing-accuracy",
  "4.2": "42-originality",
  "6.2": "62-valid-owned-url",
};

const NEXT_STEP: Record<Issue["severity"], string> = {
  reject: "Cannot go live as it is.",
  fix: "Developer can correct it; no judgement needed.",
  warn: "A person should look.",
};

/**
 * Findings for one listing, most serious first: severity, rule (linked to the
 * doc), what triggered it, the field, and what happens next.
 */
export function FindingsList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return <p className="text-emerald-800">No findings: every automated rule passed.</p>;
  }

  const sorted = [...issues].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((issue, index) => {
        const anchor = RULE_ANCHOR[issue.rule];
        return (
          <li key={`${issue.code}-${index}`} className="flex flex-col gap-1 rounded border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={issue.severity} />
              <span className="font-medium">
                Rule{" "}
                {anchor ? (
                  <a
                    href={`https://github.com/fanvue/app-store-moderation-boilerplate/blob/main/docs/listing-requirements.md#${anchor}`}
                    className="underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {issue.rule}
                  </a>
                ) : (
                  issue.rule
                )}
              </span>
              <code className="text-xs text-neutral-500">{issue.code}</code>
            </div>
            <p>{issue.message}</p>
            <p className="text-xs text-neutral-600">
              {issue.field ? (
                <>
                  Field <code>{issue.field}</code> ·{" "}
                </>
              ) : null}
              {NEXT_STEP[issue.severity]}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
