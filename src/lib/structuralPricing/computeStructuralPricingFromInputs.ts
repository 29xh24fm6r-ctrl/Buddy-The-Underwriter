import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeDebtService, resolveEffectiveRate } from "./debtServiceMath";
import type { StructuralPricingResult } from "./computeStructuralPricing";

/**
 * The shape of a deal_pricing_inputs row as returned from Supabase.
 */
export type DealPricingInputs = {
  deal_id: string;
  loan_amount: number | null;
  term_months: number;
  amort_months: number;
  interest_only_months: number;
  rate_type: "fixed" | "floating";
  fixed_rate_pct: number | null;
  index_code: string;
  index_rate_pct: number | null;
  spread_override_bps: number | null;
  base_rate_override_pct: number | null;
  floor_rate_pct: number | null;
  include_existing_debt: boolean;
  include_proposed_debt: boolean;
  origination_fee_pct: number | null;
  closing_costs: number | null;
  notes: string | null;
};

/**
 * Compute structural pricing from banker-entered pricing assumptions
 * (deal_pricing_inputs), instead of from a loan request.
 *
 * Pipeline: deal_pricing_inputs → resolve rate → compute PMT → upsert deal_structural_pricing
 *
 * Never throws. Returns { ok, data } or { ok: false, error }.
 */
export async function computeStructuralPricingFromInputs(args: {
  dealId: string;
  bankId: string;
  inputs: DealPricingInputs;
}): Promise<{ ok: true; data: StructuralPricingResult } | { ok: false; error: string }> {
  const { dealId, bankId, inputs } = args;

  try {
    const amount = inputs.loan_amount;
    if (!amount || amount <= 0) {
      return { ok: false, error: "loan_amount is required and must be > 0" };
    }

    const amortMonths = inputs.amort_months;
    if (!amortMonths || amortMonths <= 0) {
      return { ok: false, error: "amort_months must be > 0" };
    }

    const ioMonths = inputs.interest_only_months ?? 0;
    const termMonths = inputs.term_months ?? 120;

    // Resolve effective rate
    // If there's a base_rate_override, use it as index rate for floating
    const indexRatePct = inputs.base_rate_override_pct ?? inputs.index_rate_pct ?? null;

    const effectiveRate = resolveEffectiveRate({
      rateType: inputs.rate_type,
      fixedRatePct: inputs.fixed_rate_pct,
      indexRatePct,
      spreadBps: inputs.spread_override_bps,
      floorRatePct: inputs.floor_rate_pct,
    });

    if (effectiveRate == null || effectiveRate < 0) {
      return {
        ok: false,
        error: inputs.rate_type === "fixed"
          ? "fixed_rate_pct is required for fixed rate loans"
          : "Could not resolve effective rate (index + spread)",
      };
    }

    // Compute debt service
    const { monthlyPayment, annualDebtService } = computeDebtService({
      principal: amount,
      ratePct: effectiveRate,
      amortMonths,
      interestOnlyMonths: ioMonths,
    });

    // Upsert to deal_structural_pricing
    const sb = supabaseAdmin();
    const row = {
      deal_id: dealId,
      bank_id: bankId,
      loan_request_id: null, // No loan request — computed from pricing inputs
      loan_amount: amount,
      term_months: termMonths,
      amort_months: amortMonths,
      interest_only_months: ioMonths,
      rate_index: inputs.rate_type === "floating" ? inputs.index_code : null,
      requested_spread_bps: inputs.spread_override_bps ?? null,
      structural_rate_pct: effectiveRate,
      monthly_payment_est: monthlyPayment,
      annual_debt_service_est: annualDebtService,
      index_rate_pct: indexRatePct ?? null,
      floor_rate_pct: inputs.floor_rate_pct ?? 0,
      rate_type: inputs.rate_type === "fixed" ? "fixed" : "variable",
      source: "pricing_inputs",
      computed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Delete any existing pricing_inputs-sourced row for this deal, then insert.
    // This avoids conflict issues since loan_request_id is null.
    await (sb as any)
      .from("deal_structural_pricing")
      .delete()
      .eq("deal_id", dealId)
      .eq("source", "pricing_inputs");

    const { data, error } = await (sb as any)
      .from("deal_structural_pricing")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, data: data as StructuralPricingResult };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
