export const dynamic = "force-dynamic";
export const maxDuration = 30;

import DealPricingClient from "./DealPricingClientLoader";
import PricingScenariosPanel from "./PricingScenariosPanelLoader";
import PricingAssumptionsCard from "@/components/deals/cockpit/panels/PricingAssumptionsCard";
import { runDealRiskPricing } from "@/lib/pricing/runDealRiskPricing";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { deriveLifecycleState } from "@/buddy/lifecycle";
import { DealPageErrorState } from "@/components/deals/DealPageErrorState";
import { safeLoader } from "@/lib/server/safe-loader";

type PricingInputs = {
  index_code: "SOFR" | "UST_5Y" | "PRIME";
  index_tenor: string | null;
  base_rate_override_pct: number | null;
  spread_override_bps: number | null;
  loan_amount: number | null;
  term_months: number;
  amort_months: number;
  interest_only_months: number;
  notes: string | null;
};

type LatestRates = Record<
  "SOFR" | "UST_5Y" | "PRIME",
  {
    code: "SOFR" | "UST_5Y" | "PRIME";
    label: string;
    ratePct: number;
    asOf: string;
    source: "treasury" | "nyfed" | "fed_h15" | "fred";
  }
>;

type QuoteRow = {
  id: string;
  created_at: string;
  index_code: string;
  base_rate_pct: number;
  spread_bps: number;
  all_in_rate_pct: number;
  loan_amount: number;
  term_months: number;
  amort_months: number;
  interest_only_months: number;
  monthly_payment_pi: number | null;
  monthly_payment_io: number | null;
  status?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
  lock_reason?: string | null;
  underwriting_snapshot_id?: string | null;
  pricing_policy_id: string | null;
  pricing_policy_version: string | null;
  pricing_model_hash: string | null;
  pricing_explain: any;
  rate_index_snapshots?: {
    id: string;
    as_of_date: string;
    source: string;
    index_rate_pct: number;
    index_label: string;
  } | null;
};
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
    .select("requested_amount")
    .eq("deal_id", dealId)
    .order("request_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  const loanRequestAmount: number | null =
    (primaryLoanRequest as any)?.requested_amount ?? null;

  if (error || !deal) {
    return (
      <main className="p-8">
        <h1 className="text-xl font-semibold">Deal Pricing</h1>
        <p className="mt-3 text-sm text-slate-600">
          Could not load deal context for pricing.
        </p>
        <pre className="mt-4 text-xs bg-slate-100 p-3 rounded overflow-auto">
          {JSON.stringify({ dealId, error }, null, 2)}
        </pre>
      </main>
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
      <main className="p-8">
        <h1 className="text-xl font-semibold">Deal Pricing</h1>
        <DealPageErrorState
          title="Pricing data unavailable"
          message="Could not load lifecycle data for pricing. Try refreshing."
          backHref={`/deals/${dealId}/cockpit`}
          backLabel="Back to Cockpit"
          dealId={dealId}
          surface="pricing"
          technicalDetail={lifecycleResult.error ?? undefined}
        />
      </main>
    );
  }

  const lifecycle = lifecycleResult.data;
  const { spreadsComplete, financialSnapshotExists, researchComplete } = lifecycle.derived;
  const pricingReady = spreadsComplete && financialSnapshotExists && researchComplete;

  if (!pricingReady) {
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
          }}
          latestRates={null}
          inputs={null}
          quotes={[]}
          loanRequestAmount={loanRequestAmount}
          computed={null}
        />
      </div>
    );
  }

  const pricingResult = await safeLoader({
    name: "runDealRiskPricing",
    dealId,
    surface: "pricing",
    run: () => runDealRiskPricing(deal),
    fallback: null as Awaited<ReturnType<typeof runDealRiskPricing>> | null,
  });

  if (!pricingResult.ok || !pricingResult.data) {
    return (
      <div data-testid="deal-pricing" className="space-y-6">
        <PricingAssumptionsCard dealId={dealId} />
        <PricingScenariosPanel dealId={dealId} />
        <DealPageErrorState
          title="Risk pricing computation failed"
          message="Could not compute risk pricing for this deal. Assumptions and scenarios are still accessible."
          backHref={`/deals/${dealId}/cockpit`}
          backLabel="Back to Cockpit"
          dealId={dealId}
          surface="pricing"
          technicalDetail={pricingResult.error ?? undefined}
        />
      </div>
    );
  }

  const pricing = pricingResult.data;

  let inputs: PricingInputs | null = null;
  let latestRates: LatestRates | null = null; // always null from SSR — loaded client-side
  let quotes: QuoteRow[] = [];

  try {
    const [inputsRes, quotesRes] = await Promise.all([
      sb.from("deal_pricing_inputs").select("*").eq("deal_id", dealId).maybeSingle(),
      sb.from("deal_pricing_quotes").select("*, rate_index_snapshots(*)").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(20),
    ]);
    inputs = (inputsRes.data as PricingInputs | null) ?? null;
    quotes = (quotesRes.data as QuoteRow[]) ?? [];
  } catch (err) {
    console.warn("[pricing] db query failed — rendering with defaults", { dealId });
  }
  // Rates loaded client-side; SSR computes from inputs/pricing only
  const baseRatePct =
    inputs?.base_rate_override_pct ?? pricing.quote.baseRate ?? 0;
  const spreadBps = inputs?.spread_override_bps ?? pricing.quote.spreadBps ?? 0;
  const allInRatePct = baseRatePct + spreadBps / 100;

  return (
    <div data-testid="deal-pricing" className="space-y-6">
      <PricingAssumptionsCard dealId={dealId} />
      <PricingScenariosPanel dealId={dealId} />
      <DealPricingClient
        deal={deal}
        pricing={pricing}
        readinessInfo={null}
        latestRates={latestRates}
        inputs={inputs}
        quotes={quotes}
        loanRequestAmount={loanRequestAmount}
        computed={{
          baseRatePct,
          spreadBps,
          allInRatePct,
          rateAsOf: null, // populated client-side after rates fetch
          rateSource: null,
        }}
      />
    </div>
  );
}
