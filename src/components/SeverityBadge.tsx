import type { Severity } from "@/lib/moderation/rules";

/** What each status means for the moderator, from the `Severity` docs in rules.ts. */
export const STATUS_LABEL: Record<Severity | "none", string> = {
  reject: "Reject",
  fix: "Needs fix",
  warn: "Check",
  none: "No findings",
};

const STATUS_CLASS: Record<Severity | "none", string> = {
  reject: "bg-red-100 text-red-800 ring-red-300",
  fix: "bg-amber-100 text-amber-900 ring-amber-300",
  warn: "bg-sky-100 text-sky-900 ring-sky-300",
  none: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

export function SeverityBadge({ severity }: { severity: Severity | "none" }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${STATUS_CLASS[severity]}`}
    >
      {STATUS_LABEL[severity]}
    </span>
  );
}
