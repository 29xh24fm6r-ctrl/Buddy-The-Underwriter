import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import DealDocumentsClient from "@/components/deals/DealDocumentsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ dealId?: string }>;
}) {
  const { userId } = await clerkAuth();
  const { dealId } = await params;

  if (!userId) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white">Documents</h1>
        <p className="mt-2 text-sm text-white/70">Please sign in to continue.</p>
      </div>
    );
  }

  if (!dealId || dealId === "undefined") {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white">Documents</h1>
        <p className="mt-2 text-sm text-white/70">Loading deal…</p>
      </div>
    );
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white">Documents</h1>
        <p className="mt-2 text-sm text-white/70">Deal not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <DealDocumentsClient dealId={dealId} />
    </div>
  );
}
