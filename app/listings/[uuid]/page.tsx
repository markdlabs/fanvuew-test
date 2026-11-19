import Link from "next/link";

import { ListingDetail } from "@/components/ListingDetail";
import { createReviewStore } from "@/lib/moderation/store";

export const dynamic = "force-dynamic";

/**
 * One listing's stored review. No API calls: if the job has not stored this
 * uuid, the page says so rather than fetching it.
 */
export default async function ListingDetailPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;

  const startedAt = performance.now();
  const review = await createReviewStore().getReview(uuid.toLowerCase());
  const ms = Math.round(performance.now() - startedAt);

  if (!review) {
    return (
      <section className="flex flex-col gap-4 text-sm">
        <Link href="/" className="underline">
          Back to queue
        </Link>
        <h1 className="text-2xl font-semibold">Not reviewed yet</h1>
        <p>
          There is no stored review for <code>{uuid}</code>. Either the review job has not reached this listing yet, or
          no listing has this id. It will appear here after the next <code>npm run review</code>.
        </p>
      </section>
    );
  }

  return (
    <>
      <ListingDetail
        listing={review.listing}
        issues={review.issues}
        ruleRevision={review.ruleRevision}
        reviewedAt={review.reviewedAt}
      />
      <p className="mt-6 text-xs text-neutral-500">
        Read from the review store in {ms.toLocaleString()} ms. This page made no API calls.
      </p>
    </>
  );
}
