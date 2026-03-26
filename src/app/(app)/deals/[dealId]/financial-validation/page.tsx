import { Suspense } from "react";
import { redirect } from "next/navigation";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { DealPageErrorState } from "@/components/deals/DealPageErrorState";
import { safeLoader } from "@/lib/server/safe-loader";
import { FinancialValidationWorkbench } from "@/components/deals/FinancialValidationWorkbench";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ dealId: string }> };

export default async function FinancialValidationPage({ params }: Props) {
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");

  const { dealId } = await params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <div className="p-6">
        <DealPageErrorState
          title={access.error === "deal_not_found" ? "Deal Not Found" : "Access Denied"}
          message={access.error === "deal_not_found"
            ? "This deal does not exist or has been deleted."
            : "You do not have permission to view this deal."}
          backHref="/deals"
          backLabel="Back to Deals"
          dealId={dealId}
          surface="financial-validation"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Suspense fallback={
        <div className="flex h-screen items-center justify-center">
          <div className="text-sm text-white/30 animate-pulse">Loading financial validation...</div>
        </div>
      }>
        <FinancialValidationWorkbench dealId={dealId} />
      </Suspense>
    </div>
  );
}
