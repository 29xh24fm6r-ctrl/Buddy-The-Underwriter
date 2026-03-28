import { Suspense } from "react";
import SpecialAssetsPageClient from "@/components/special-assets/SpecialAssetsPageClient";

export const dynamic = "force-dynamic";

export default async function SpecialAssetsPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16"><p className="text-white/40 text-sm">Loading...</p></div>}>
      <SpecialAssetsPageClient dealId={dealId} />
    </Suspense>
  );
}
