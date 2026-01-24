// src/app/(app)/deals/[dealId]/committee/page.tsx
import { CommitteeView } from "./CommitteeView";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveLifecycleState, PageGuards, getBlockerExplanation, STAGE_LABELS } from "@/buddy/lifecycle";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CommitteePage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams?: Promise<{ snapshotId?: string }>;
}) {
  const { dealId } = await params;
  const searchParamsResolved = searchParams ? await searchParams : {};
  const snapshotId = searchParamsResolved?.snapshotId;

  if (!dealId) {
    return (
      <main className="min-h-screen p-10">
        <div className="mx-auto max-w-6xl text-red-600">
          Missing dealId — route params not found.
        </div>
      </main>
    );
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <main className="min-h-screen p-10">
        <div className="mx-auto max-w-6xl text-red-600">
          Unable to access this deal.
        </div>
      </main>
    );
  }

  // Unified lifecycle guard: deal must be at committee_ready or beyond
  const lifecycleState = await deriveLifecycleState(dealId);
  const lifecycleGuard = PageGuards.committee(lifecycleState, dealId);
  if (!lifecycleGuard.ok) {
    const explanation = getBlockerExplanation(lifecycleGuard);
    return (
      <main className="min-h-screen p-10">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
            <h1 className="text-2xl font-bold text-amber-900">Committee Not Available</h1>
            <p className="mt-2 text-sm text-amber-700">
              This deal is currently in the <strong>{STAGE_LABELS[lifecycleGuard.currentStage]}</strong> stage.
              Committee review requires the deal to be &ldquo;Ready for Committee&rdquo; or beyond.
            </p>
            {explanation && (
              <p className="mt-2 text-xs text-amber-600">{explanation}</p>
            )}
            <div className="mt-4">
              <Link
                href={`/deals/${dealId}/cockpit`}
                className="inline-flex items-center rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Go to Deal Cockpit
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("borrower_name, entity_type")
    .eq("id", dealId)
    .eq("bank_id", access.bankId)
    .maybeSingle();

  const borrowerName = deal?.borrower_name ?? "Unknown Borrower";
  const borrowerEntityType = deal?.entity_type ?? "Unknown";

  let snapshot: { createdAt: string } | null = null;
  if (snapshotId) {
    const { data: snap } = await sb
      .from("deal_context_snapshots")
      .select("created_at")
      .eq("id", snapshotId)
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .maybeSingle();
    if (snap?.created_at) {
      snapshot = { createdAt: snap.created_at };
    }
  }

  return (
    <CommitteeView
      dealId={dealId}
      borrowerName={borrowerName}
      borrowerEntityType={borrowerEntityType}
      snapshot={snapshot}
    />
  );
}
