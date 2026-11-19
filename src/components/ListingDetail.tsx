import Link from "next/link";

import type { AppListing } from "@/lib/fanvue/types";
import { worstSeverity } from "@/lib/moderation/queue";
import type { Issue } from "@/lib/moderation/rules";

import { FindingsList } from "./FindingsList";
import { SeverityBadge } from "./SeverityBadge";

/**
 * One listing: its stored findings first, then the fields the rules work with.
 */
export function ListingDetail({
  listing,
  issues,
  ruleRevision,
  reviewedAt,
}: {
  listing: AppListing;
  issues: Issue[];
  ruleRevision: string;
  reviewedAt: string;
}) {
  const worst = worstSeverity(issues) ?? "none";
  return (
    <article className="flex flex-col gap-6 text-sm">
      <Link href="/" className="underline">
        Back to queue
      </Link>

      <header className="flex items-start gap-4">
        <img src={listing.logoUrl} alt="" width={64} height={64} />
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            {listing.name} <SeverityBadge severity={worst} />
          </h1>
          <p>{listing.tagline}</p>
          <p>
            {listing.developer.name ?? "Unknown developer"}
            {listing.developer.handle ? ` (@${listing.developer.handle})` : ""} · {listing.pricingType} · rating{" "}
            {listing.rating.average ?? "-"} ({listing.rating.count ?? 0})
          </p>
        </div>
      </header>

      <section>
        <h2 className="mb-1 font-semibold">Findings</h2>
        <p className="mb-3 text-xs text-neutral-600">
          Reviewed {new Date(reviewedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}{" "}
          UTC under Listing Requirements revision {ruleRevision}.
        </p>
        <FindingsList issues={issues} />
      </section>

      <section>
        <h2 className="font-semibold">Copy</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <Field label="description" value={listing.description} />
          <Field label="descriptionTitle" value={listing.descriptionTitle} />
          <Field label="descriptionBody" value={listing.descriptionBody} />
          <Field label="highlights" value={listing.highlights.length ? listing.highlights.join(" | ") : "(none)"} />
        </dl>
      </section>

      <section>
        <h2 className="font-semibold">Integration</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <Field label="appUrl" value={listing.appUrl ?? "(null)"} />
          <Field label="uuid" value={listing.uuid} />
          <Field label="logoUrl" value={listing.logoUrl} />
        </dl>
      </section>

      <section>
        <h2 className="font-semibold">Images</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <Field label="heroImageUrl" value={listing.heroImageUrl} />
          <Field
            label="previewImageUrls"
            value={`${listing.previewImageUrls.length}: ${listing.previewImageUrls.join(" ")}`}
          />
          <Field
            label="galleryImageUrls"
            value={`${listing.galleryImageUrls.length}: ${listing.galleryImageUrls.join(" ")}`}
          />
        </dl>
      </section>

      <section>
        <h2 className="font-semibold">Pricing plans</h2>
        {listing.pricingPlans.length === 0 ? (
          <p>(no plans)</p>
        ) : (
          <table className="border-collapse text-left">
            <thead>
              <tr className="border-b">
                <th className="py-1 pr-4">name</th>
                <th className="py-1 pr-4">description</th>
                <th className="py-1 pr-4">billingType</th>
                <th className="py-1 pr-4">interval</th>
                <th className="py-1 pr-4">price</th>
                <th className="py-1 pr-4">currency</th>
                <th className="py-1 pr-4">status</th>
                <th className="py-1 pr-4">highlights</th>
              </tr>
            </thead>
            <tbody>
              {listing.pricingPlans.map((plan) => (
                <tr key={plan.uuid} className="border-b">
                  <td className="py-1 pr-4">{plan.name}</td>
                  <td className="py-1 pr-4">{plan.description}</td>
                  <td className="py-1 pr-4">{plan.billingType}</td>
                  <td className="py-1 pr-4">{plan.interval ?? "(null)"}</td>
                  <td className="py-1 pr-4">{plan.price}</td>
                  <td className="py-1 pr-4">{plan.currencyCode}</td>
                  <td className="py-1 pr-4">{plan.status}</td>
                  <td className="py-1 pr-4">{plan.highlights.join(" | ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-mono text-xs text-neutral-500">{label}</dt>
      <dd className="m-0 break-words">{value}</dd>
    </>
  );
}
