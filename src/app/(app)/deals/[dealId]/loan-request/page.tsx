import { Suspense } from "react";
import { redirect } from "next/navigation";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { LoanRequestsSection } from "@/components/loanRequests/LoanRequestsSection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ dealId?: string }>;
};

/**
 * SPEC-LOAN-REQUEST-CTA-FIX-1: Dedicated page for the loan request entry form.
 *
 * Replaces the dead cockpit tab=setup destination. The cockpit page no
 * longer mounts SecondaryTabsPanel (per SPEC-01), so tab query params
 * are silently ignored. Bankers navigating to "Add Loan Request" need a
 * real destination that renders the form.
 */
export default async function LoanRequestPage({ params }: Props) {
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");

  const { dealId } = await params;
  if (!dealId || dealId === "undefined") {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold text-neutral-100">Loading…</h1>
      </div>
    );
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const err = access.error;
    const title =
      err === "deal_not_found" ? "Deal Not Found" :
      err === "tenant_mismatch" ? "Access Denied" :
      "Unauthorized";
    const detail =
      err === "deal_not_found" ? "This deal does not exist or has been deleted." :
      err === "tenant_mismatch" ? "This deal belongs to a different bank." :
      "You do not have permission to view this deal.";
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="max-w-md text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
            <span className="material-symbols-outlined text-red-400 text-2xl">error</span>
          </div>
          <h1 className="text-xl font-bold text-white">{title}</h1>
          <p className="text-sm text-white/60">{detail}</p>
          <a href={`/deals/${dealId}/cockpit`} className="inline-flex items-center rounded-lg bg-white/10 border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">
            Back to Deal
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="mb-6">
        <a
          href={`/deals/${dealId}/cockpit`}
          className="text-sm text-white/60 hover:text-white"
        >
          ← Back to deal
        </a>
      </div>
      <h1 className="text-2xl font-bold text-neutral-100 mb-2">
        Loan Request
      </h1>
      <p className="text-sm text-neutral-400 mb-6">
        Capture the loan structure the borrower needs. Submitting a request will trigger structural pricing and DSCR computation.
      </p>
      <Suspense fallback={<div className="text-sm text-neutral-400">Loading…</div>}>
        <LoanRequestsSection dealId={dealId} />
      </Suspense>
    </div>
  );
}
