import { Suspense } from "react";
import PostClosePageClient from "@/components/post-close/PostClosePageClient";

export const dynamic = "force-dynamic";

export default async function PostClosePage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <p className="text-white/40 text-sm">Loading...</p>
        </div>
      }
    >
      <PostClosePageClient dealId={dealId} />
    </Suspense>
  );
}
