/**
 * Underwriting Engine — Deal Instrument Loader
 *
 * Loads debt instruments from deal_existing_debt_schedule and deal_structural_pricing.
 * Converts to DebtInstrument[] for the debt engine.
 *
 * PHASE 9: DB read only — no mutations, no side effects.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { DebtInstrument } from "@/lib/debtEngine/types";

/**
 * Load debt instruments for a deal.
 *
 * Sources:
 * 1. Existing debt schedule (not being refinanced, included in global cash flow)
 * 2. Proposed loan from structural pricing (latest computation)
 */
export async function loadDealInstruments(
  dealId: string,
): Promise<DebtInstrument[]> {
  const sb = supabaseAdmin();
  const instruments: DebtInstrument[] = [];

  // 1. Existing debt (not being refinanced, included in global)
  const { data: existing } = await sb
    .from("deal_existing_debt_schedule")
    .select("id, current_balance, original_amount, interest_rate_pct, is_being_refinanced, included_in_global")
    .eq("deal_id", dealId)
    .eq("is_being_refinanced", false)
    .eq("included_in_global", true);

  for (const row of existing ?? []) {
    instruments.push({
      id: row.id,
      source: "existing",
      principal: row.current_balance ?? row.original_amount ?? 0,
      rate: (row.interest_rate_pct ?? 0) / 100,
      amortizationMonths: 300, // conservative 25yr default
      paymentFrequency: "monthly",
    });
  }

  // 2. Proposed loan from structural pricing (latest computation)
  const { data: proposed } = await sb
    .from("deal_structural_pricing")
    .select("loan_amount, structural_rate_pct, amort_months")
    .eq("deal_id", dealId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (proposed?.loan_amount) {
    instruments.push({
      id: `proposed-${dealId}`,
      source: "proposed",
      principal: proposed.loan_amount,
      rate: (proposed.structural_rate_pct ?? 6.5) / 100,
      amortizationMonths: proposed.amort_months ?? 300,
      paymentFrequency: "monthly",
    });
  }

  return instruments;
}
