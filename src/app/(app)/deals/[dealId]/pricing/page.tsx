export const dynamic = "force-dynamic";
export const maxDuration = 30;

import DealPricingClient from "./DealPricingClientLoader";
import PricingScenariosPanel from "./PricingScenariosPanelLoader";
import PricingAssumptionsCard from "@/components/deals/cockpit/panels/PricingAssumptionsCard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { deriveLifecycleState } from "@/buddy/lifecycle";
import { DealPageErrorState } from "@/components/deals/DealPageErrorState";
import { safeLoader } from "@/lib/server/safe-loader";

export default async function Page(
  props: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await props.params;

  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) redirect("/select-bank");
  const bankId = bankPick.bankId;
  const sb = supabaseAdmin();

  const { data: deal, error } = await sb
    .from("deals")
    .select(
      "id, bank_id, borrower_name, stage, risk_score, noi, dscr, ltv",
    )
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();

  // Fetch primary loan request amount (first by request_number)
  const { data: primaryLoanRequest } = await sb
    .from("deal_loan_requests")
    .select("requested_amount, product_type")
    .eq("deal_id", dealId)
    .order("request_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  const loanRequestAmount: number | null =
    (primaryLoanRequest as any)?.requested_amount ?? null;
  const loanProductType: string | null =
    (primaryLoanRequest as any)?.product_type ?? null;

  if (error || !deal) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-white">Deal Pricing</h1>
        <p className="mt-3 text-sm text-white/60">
          Could not load deal context for pricing.
        </p>
        <pre className="mt-4 text-xs bg-white/5 text-white/70 p-3 rounded overflow-auto">
          {JSON.stringify({ dealId, error }, null, 2)}
        </pre>
      </div>
    );
  }

  // Gate risk pricing behind spreads + snapshot + research completion
  const lifecycleResult = await safeLoader({
    name: "deriveLifecycleState",
    dealId,
    surface: "pricing",
    run: () => deriveLifecycleState(dealId),
    fallback: null as Awaited<ReturnType<typeof deriveLifecycleState>> | null,
  });

  if (!lifecycleResult.ok || !lifecycleResult.data) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-white">Deal Pricing</h1>
        <DealPageErrorState
          title="Pricing data unavailable"
          message="Could not load lifecycle data for pricing. Try refreshing."
          backHref={`/deals/${dealId}/cockpit`}
          backLabel="Back to Cockpit"
          dealId={dealId}
          surface="pricing"
          technicalDetail={lifecycleResult.error ?? undefined}
        />
      </div>
    );
  }

  const lifecycle = lifecycleResult.data;
  const { spreadsComplete, financialSnapshotExists, researchComplete } = lifecycle.derived;
  const pricingReady = spreadsComplete && financialSnapshotExists && researchComplete;

  if (!pricingReady) {
    // Query spread job status so DealPricingClient can show conditional messaging
    // instead of always saying "Go to Spreads" when the spread already succeeded.
    let spreadJobStatus: "none" | "running" | "succeeded" | "failed" = "none";
    try {
      const { data: latestJob } = await sb
        .from("deal_spread_jobs")
        .select("status")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestJob) {
        const s = (latestJob as any).status as string;
        if (s === "SUCCEEDED") spreadJobStatus = "succeeded";
        else if (s === "RUNNING" || s === "QUEUED") spreadJobStatus = "running";
        else if (s === "FAILED") spreadJobStatus = "failed";
      }
    } catch {
      // Non-fatal — default to "none"
    }

    return (
      <div data-testid="deal-pricing" className="space-y-6">
        <PricingAssumptionsCard dealId={dealId} />
        <PricingScenariosPanel dealId={dealId} />
        <DealPricingClient
          deal={deal}
          pricing={null}
          readinessInfo={{
            spreadsComplete,
            financialSnapshotExists,
            researchComplete,
            stage: lifecycle.stage,
            spreadJobStatus,
          }}
          latestRates={null}
          inputs={null}
          quotes={[]}
          loanRequestAmount={loanRequestAmount}
          productType={loanProductType}
          computed={null}
        />
      </div>
    );
  }

  // Use canonical resolver to ensure deal_pricing_inputs exists and is correct.
  // This upserts from structural pricing / loan request if missing or stale.
  const { resolveCanonicalPricingContext } = await import(
    "@/lib/pricing/resolveCanonicalPricingContext"
  );
  await resolveCanonicalPricingContext(dealId, bankId);

  // SPEC-PRICING-CANONICAL-SOURCE-OF-TRUTH-1: /pricing renders only two
  // canonical surfaces when ready — PricingAssumptionsCard (editable) and
  // PricingScenariosPanel (scenario output + decision). DealPricingClient
  // ("Risk-Based Pricing") removed to eliminate duplicate conflicting form.
  return (
    <div data-testid="deal-pricing" className="space-y-6">
      <PricingAssumptionsCard dealId={dealId} />
      <PricingScenariosPanel dealId={dealId} />
    </div>
  );
}
