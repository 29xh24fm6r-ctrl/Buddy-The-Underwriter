// src/lib/pricing/compute.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export type PricingInput = {
  dealId: string;
  productType: string; // "SBA_7A", "SBA_504_1ST", "CLOC", etc.
  riskGrade: string; // "1".."10" or "A".."E"
  termMonths: number;
  indexName: string; // "SOFR", "Prime"
  indexRateBps: number; // current index rate in basis points
};

export type PricingResult = {
  quoteId: string;
  finalRateBps: number;
  baseSpreadBps: number;
  overrideSpreadBps: number;
  explain: {
    policyName: string;
    productType: string;
    riskGrade: string;
    termMonths: number;
    indexName: string;
    indexRateBps: number;
    gridRow: string;
    override: string | null;
  };
};

/**
 * Compute risk-based price for a deal
 * 
 * Returns a deterministic, explainable quote with audit trail
 */
export async function computePricing(input: PricingInput): Promise<PricingResult> {
  const sb = supabaseAdmin();

  // 1. Find active policy
  const { data: policy } = await sb
    .from("pricing_policies")
    .select("id, name")
    .eq("status", "active")
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!policy) {
    throw new Error("No active pricing policy found");
  }

  // 2. Find matching grid row
  const { data: gridRows } = await sb
    .from("pricing_grid_rows")
    .select("*")
    .eq("policy_id", policy.id)
    .eq("product_type", input.productType)
    .eq("risk_grade", input.riskGrade)
    .lte("term_min_months", input.termMonths)
    .gte("term_max_months", input.termMonths)
    .limit(1);

  const gridRow = gridRows?.[0];
  if (!gridRow) {
    throw new Error(
      `No pricing grid row found for product=${input.productType}, risk=${input.riskGrade}, term=${input.termMonths}`
    );
  }

  const baseSpreadBps = Number(gridRow.base_spread_bps);
  let overrideSpreadBps = 0;
  let overrideReason: string | null = null;

  // 3. Check for deal-specific overrides
  const { data: overrides } = await sb
    .from("pricing_overrides")
    .select("*")
    .eq("deal_id", input.dealId)
    .eq("policy_id", policy.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (overrides?.[0]) {
    overrideSpreadBps = Number(overrides[0].spread_delta_bps ?? 0);
    overrideReason = String(overrides[0].reason ?? "Manual override");
  }

  // 4. Compute final rate
  let finalRateBps = input.indexRateBps + baseSpreadBps + overrideSpreadBps;

  // Apply floor/ceiling if defined
  if (gridRow.floor_rate_bps != null && finalRateBps < Number(gridRow.floor_rate_bps)) {
    finalRateBps = Number(gridRow.floor_rate_bps);
  }
  if (gridRow.ceiling_rate_bps != null && finalRateBps > Number(gridRow.ceiling_rate_bps)) {
    finalRateBps = Number(gridRow.ceiling_rate_bps);
  }

  // 5. Save quote snapshot (audit trail)
  const explain = {
    policyName: policy.name,
    productType: input.productType,
    riskGrade: input.riskGrade,
    termMonths: input.termMonths,
    indexName: input.indexName,
    indexRateBps: input.indexRateBps,
    gridRow: `${input.productType} / Grade ${input.riskGrade} / ${gridRow.term_min_months}-${gridRow.term_max_months}mo = ${baseSpreadBps}bps`,
    override: overrideReason,
  };

  const { data: quote, error } = await sb
    .from("pricing_quotes")
    .insert({
      deal_id: input.dealId,
      policy_id: policy.id,
      product_type: input.productType,
      risk_grade: input.riskGrade,
      term_months: input.termMonths,
      index_name: input.indexName,
      index_rate_bps: input.indexRateBps,
      base_spread_bps: baseSpreadBps,
      override_spread_bps: overrideSpreadBps,
      final_rate_bps: finalRateBps,
      explain,
    })
    .select("id")
    .single();

  if (error) throw error;

  return {
    quoteId: quote.id,
    finalRateBps,
    baseSpreadBps,
    overrideSpreadBps,
    explain,
  };
}

/**
 * Format rate for borrower display (borrower-safe, no internal logic)
 */
export function formatBorrowerRate(rateBps: number): string {
  const percent = (rateBps / 100).toFixed(2);
  return `${percent}%`;
}
