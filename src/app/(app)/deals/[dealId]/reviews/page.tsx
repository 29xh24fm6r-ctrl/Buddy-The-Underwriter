import { Suspense } from "react";
import ReviewsPageClient from "@/components/reviews/ReviewsPageClient";

export const dynamic = "force-dynamic";

export default async function ReviewsPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16"><p className="text-white/40 text-sm">Loading...</p></div>}>
      <ReviewsPageClient dealId={dealId} />
    </Suspense>
  );
}
