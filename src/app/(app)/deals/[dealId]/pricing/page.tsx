export const dynamic = "force-dynamic";

import DealPricingClient from "./DealPricingClient";
import { headers } from "next/headers";
import { runDealRiskPricing } from "@/lib/pricing/runDealRiskPricing";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

type PricingInputs = {
  index_code: "SOFR" | "UST_5Y" | "PRIME";
  index_source: string;
  index_tenor: string | null;
  index_rate_pct: number | null;
  loan_amount: number | null;
  term_months: number;
  amort_months: number;
  interest_only_months: number;
  spread_override_bps: number | null;
  base_rate_override_pct: number | null;
  notes: string | null;
};

type LatestRates = Record<
  "SOFR" | "UST_5Y" | "PRIME",
  {
    code: "SOFR" | "UST_5Y" | "PRIME";
    label: string;
    ratePct: number;
    asOf: string;
    source: "treasury" | "nyfed" | "fed_h15";
  }
>;

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

  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data: deal, error } = await sb
    .from("deals")
    .select(
      "id, bank_id, borrower_name, stage, risk_score, requested_loan_amount, project_cost, property_value, noi, dscr, ltv",
    )
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .single();

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

  const [inputsRes, ratesRes] = await Promise.all([
    fetch(`${baseUrl}/api/deals/${dealId}/pricing/inputs`, { cache: "no-store" }),
    fetch(`${baseUrl}/api/rates/latest`, { cache: "no-store" }),
  ]);

  let inputs: PricingInputs | null = null;
  let latestRates: LatestRates | null = null;

  if (inputsRes.ok) {
    const payload = await inputsRes.json();
    inputs = payload?.inputs ?? null;
  }

  if (ratesRes.ok) {
    const payload = await ratesRes.json();
    latestRates = payload?.rates ?? null;
  }

  const indexCode = inputs?.index_code ?? "SOFR";
  const rateEntry = latestRates?.[indexCode] ?? latestRates?.SOFR ?? null;
  const baseRatePct =
    inputs?.base_rate_override_pct ?? rateEntry?.ratePct ?? pricing.quote.baseRate ?? 0;
  const spreadBps = inputs?.spread_override_bps ?? pricing.quote.spreadBps ?? 0;
  const allInRatePct = baseRatePct + spreadBps / 100;

  return (
    <DealPricingClient
      deal={deal}
      pricing={pricing}
      latestRates={latestRates}
      inputs={inputs}
      computed={{
        baseRatePct,
        spreadBps,
        allInRatePct,
        rateAsOf: rateEntry?.asOf ?? null,
      }}
    />
  );
}
