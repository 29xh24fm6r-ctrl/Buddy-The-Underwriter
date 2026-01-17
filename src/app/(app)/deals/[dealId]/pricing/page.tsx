export const dynamic = "force-dynamic";

import DealPricingClient from "./DealPricingClient";
import { runDealRiskPricing } from "@/lib/pricing/runDealRiskPricing";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

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

  return <DealPricingClient deal={deal} pricing={pricing} />;
}
