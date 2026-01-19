// src/app/(app)/deals/[dealId]/committee/page.tsx
import { CommitteeView } from "./CommitteeView";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
