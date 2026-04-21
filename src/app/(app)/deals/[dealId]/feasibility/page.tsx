import { clerkAuth } from "@/lib/auth/clerkServer";
import { redirect } from "next/navigation";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { DealPageErrorState } from "@/components/deals/DealPageErrorState";
import FeasibilityDashboard from "@/components/feasibility/FeasibilityDashboard";

export default async function DealFeasibilityPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");

  const { dealId } = await params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <div className="p-6">
        <DealPageErrorState
          title={
            access.error === "deal_not_found" ? "Deal Not Found" : "Access Denied"
          }
          message={
            access.error === "deal_not_found"
              ? "This deal does not exist or has been deleted."
              : "You do not have permission to view this deal."
          }
          backHref="/deals"
          backLabel="Back to Deals"
          dealId={dealId}
          surface="feasibility"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Feasibility Study</h1>
      </div>
      <FeasibilityDashboard dealId={dealId} />
    </div>
  );
}
