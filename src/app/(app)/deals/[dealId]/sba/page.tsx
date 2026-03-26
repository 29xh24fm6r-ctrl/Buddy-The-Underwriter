import { clerkAuth } from "@/lib/auth/clerkServer";
import { redirect } from "next/navigation";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DealPageErrorState } from "@/components/deals/DealPageErrorState";
import { SbaScoreCard } from "@/components/sba/SbaScoreCard";
import { SbaIssuesPanel } from "@/components/sba/SbaIssuesPanel";
import { SbaActionsPanel } from "@/components/sba/SbaActionsPanel";

export default async function DealSbaPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");

  const { dealId } = await params;

  // Phase 53C: Explicit tenant/deal access check
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <div className="p-6">
        <DealPageErrorState
          title={access.error === "deal_not_found" ? "Deal Not Found" : "Access Denied"}
          message={
            access.error === "deal_not_found"
              ? "This deal does not exist or has been deleted."
              : "You do not have permission to view this deal."
          }
          backHref="/deals"
          backLabel="Back to Deals"
          dealId={dealId}
          surface="sba"
        />
      </div>
    );
  }

  const sb = supabaseAdmin();

  const { data: preflight } = await (sb as any)
    .from("sba_preflight_results")
    .select("*")
    .eq("application_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">SBA Console</h1>

      <SbaScoreCard preflight={preflight} />
      <SbaIssuesPanel preflight={preflight} />
      <SbaActionsPanel dealId={dealId} preflight={preflight} />
    </div>
  );
}
