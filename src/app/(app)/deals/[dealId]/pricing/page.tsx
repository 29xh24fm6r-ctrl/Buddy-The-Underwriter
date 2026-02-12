export const dynamic = "force-dynamic";

import DealPricingClient from "./DealPricingClient";
import PricingScenariosPanel from "./PricingScenariosPanel";
import PricingAssumptionsCard from "@/components/deals/cockpit/panels/PricingAssumptionsCard";
import { headers } from "next/headers";
import { runDealRiskPricing } from "@/lib/pricing/runDealRiskPricing";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";

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
async function getBaseUrl() {
  const envBase = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (envBase) return envBase.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (!host) return "http://localhost:3000";
  return `${proto}://${host}`;
}

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
    .single();

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

  const pricing = await runDealRiskPricing(deal);
  const baseUrl = await getBaseUrl();

  const [inputsRes, ratesRes, quotesRes] = await Promise.all([
    fetch(`${baseUrl}/api/deals/${dealId}/pricing/inputs`, { cache: "no-store" }),
    fetch(`${baseUrl}/api/rates/latest`, { cache: "no-store" }),
    fetch(`${baseUrl}/api/deals/${dealId}/pricing/quotes`, { cache: "no-store" }),
  ]);

  let inputs: PricingInputs | null = null;
  let latestRates: LatestRates | null = null;
  let quotes: QuoteRow[] = [];

  if (inputsRes.ok) {
    const payload = await inputsRes.json();
    inputs = payload?.inputs ?? null;
  }

  if (ratesRes.ok) {
    const payload = await ratesRes.json();
    latestRates = payload?.rates ?? null;
  }

  if (quotesRes.ok) {
    const payload = await quotesRes.json();
    quotes = payload?.quotes ?? [];
  }
  const indexCode = inputs?.index_code ?? "SOFR";
  const rateEntry = latestRates?.[indexCode] ?? latestRates?.SOFR ?? null;
  const baseRatePct =
    inputs?.base_rate_override_pct ?? rateEntry?.ratePct ?? pricing.quote.baseRate ?? 0;
  const spreadBps = inputs?.spread_override_bps ?? pricing.quote.spreadBps ?? 0;
  const allInRatePct = baseRatePct + spreadBps / 100;

  return (
    <div data-testid="deal-pricing" className="space-y-6">
      <PricingAssumptionsCard dealId={dealId} />
      <PricingScenariosPanel dealId={dealId} />
      <DealPricingClient
        deal={deal}
        pricing={pricing}
        latestRates={latestRates}
        inputs={inputs}
        quotes={quotes}
        loanRequestAmount={loanRequestAmount}
        computed={{
          baseRatePct,
          spreadBps,
          allInRatePct,
          rateAsOf: rateEntry?.asOf ?? null,
          rateSource: rateEntry?.source ?? null,
        }}
      />
    </div>
  );
}
