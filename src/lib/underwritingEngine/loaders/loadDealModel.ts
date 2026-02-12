/**
 * Underwriting Engine — Deal Model Loader
 *
 * Loads deal_financial_facts from Supabase and converts to FinancialModel
 * via the existing buildFinancialModel() builder.
 *
 * PHASE 9: DB read → pure model builder.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FinancialModel } from "@/lib/modelEngine/types";
import { buildFinancialModel } from "@/lib/modelEngine/buildFinancialModel";

/**
 * Load financial facts for a deal and build a FinancialModel.
 * Returns a model with zero periods if no facts exist.
 */
export async function loadDealModel(dealId: string): Promise<FinancialModel> {
  const sb = supabaseAdmin();

  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("fact_type, fact_key, fact_value_num, fact_period_end, confidence")
    .eq("deal_id", dealId);

  return buildFinancialModel(dealId, facts ?? []);
}
