import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { LoanRequest } from "@/lib/loanRequests/types";
import { computeDebtService } from "./debtServiceMath";

export type StructuralPricingResult = {
  id: string;
  deal_id: string;
  loan_request_id: string | null;
  loan_amount: number;
  term_months: number;
  amort_months: number;
  interest_only_months: number;
  rate_index: string | null;
  requested_spread_bps: number | null;
  structural_rate_pct: number | null;
  monthly_payment_est: number | null;
  annual_debt_service_est: number | null;
  source: string;
};

const DEFAULT_FALLBACK_RATE_PCT = 5.0;

/**
 * Compute structural pricing from a loan request.
 *
 * Resolves base rate via live index feeds, computes monthly P&I using the same
 * amortization math as financialStressEngine.ts, and upserts to
 * deal_structural_pricing on (deal_id, loan_request_id).
 */
export async function computeStructuralPricing(
  loanRequest: LoanRequest,
): Promise<{ ok: true; data: StructuralPricingResult } | { ok: false; error: string }> {
  try {
    const amount = loanRequest.requested_amount;
    if (!amount || amount <= 0) {
      return { ok: false, error: "Loan request has no requested_amount" };
    }

    const termMonths = loanRequest.requested_term_months ?? 120;
    const amortMonths = loanRequest.requested_amort_months ?? 300;
    const ioMonths = loanRequest.requested_interest_only_months ?? 0;
    const rateIndex = loanRequest.requested_rate_index ?? null;
    const spreadBps = loanRequest.requested_spread_bps ?? null;

    // Resolve base rate from live feeds (fail-soft)
    let baseRatePct = DEFAULT_FALLBACK_RATE_PCT;
    if (rateIndex) {
      try {
        const { getLatestIndexRates } = await import("@/lib/rates/indexRates");
        const rates = await getLatestIndexRates();
        const matched = rates[rateIndex as keyof typeof rates];
        if (matched?.ratePct) {
          baseRatePct = matched.ratePct;
        }
      } catch {
        // Fall back to default rate
      }
    }

    // Compute structural rate
    const spreadPct = spreadBps != null ? spreadBps / 100 : 0;
    const structuralRatePct = baseRatePct + spreadPct;

    // Compute monthly payment and annual debt service
    const { monthlyPayment, annualDebtService } = computeDebtService({
      principal: amount,
      ratePct: structuralRatePct,
      amortMonths,
      interestOnlyMonths: ioMonths,
    });

    // Upsert to deal_structural_pricing
    const sb = supabaseAdmin();
    const row = {
      deal_id: loanRequest.deal_id,
      bank_id: loanRequest.bank_id,
      loan_request_id: loanRequest.id,
      loan_amount: amount,
      term_months: termMonths,
      amort_months: amortMonths,
      interest_only_months: ioMonths,
      rate_index: rateIndex,
      requested_spread_bps: spreadBps,
      structural_rate_pct: structuralRatePct,
      monthly_payment_est: monthlyPayment,
      annual_debt_service_est: annualDebtService,
      index_rate_pct: baseRatePct,
      floor_rate_pct: 0,
      rate_type: rateIndex ? "variable" : "fixed",
      source: "auto",
      computed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await (sb as any)
      .from("deal_structural_pricing")
      .upsert(row, { onConflict: "deal_id,loan_request_id" })
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
