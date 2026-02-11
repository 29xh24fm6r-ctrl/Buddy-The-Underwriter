import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * DSCR-based risk grade tiers.
 *
 * Grade | DSCR Range    | Model Spread (bps)
 * A     | >= 1.50       | 100
 * B     | 1.25 - 1.49   | 150
 * C     | 1.10 - 1.24   | 250
 * D     | < 1.10        | 350
 */
type RiskGrade = "A" | "B" | "C" | "D";

function gradeFromDscr(dscr: number): { grade: RiskGrade; spreadBps: number } {
  if (dscr >= 1.5) return { grade: "A", spreadBps: 100 };
  if (dscr >= 1.25) return { grade: "B", spreadBps: 150 };
  if (dscr >= 1.1) return { grade: "C", spreadBps: 250 };
  return { grade: "D", spreadBps: 350 };
}

/**
 * LTV adjustment to model spread:
 *   <= 70%: -25 bps
 *   70-80%: 0 bps
 *   > 80%: +50 bps
 */
function ltvAdjustmentBps(ltv: number | null): number {
  if (ltv == null) return 0;
  if (ltv <= 70) return -25;
  if (ltv <= 80) return 0;
  return 50;
}

export type RiskPricingModel = {
  id: string;
  deal_id: string;
  risk_grade: RiskGrade;
  model_spread_bps: number;
  dscr: number | null;
  global_dscr: number | null;
  ltv: number | null;
  banker_adjustment_bps: number;
  final_rate_pct: number | null;
  final_monthly_payment: number | null;
  finalized: boolean;
};

/**
 * Compute risk pricing for a deal.
 *
 * 1. Load latest snapshot → DSCR, LTV, GCF_DSCR
 * 2. Load structural pricing → base rate, amort, principal
 * 3. Grade DSCR → model spread
 * 4. Apply LTV adjustment
 * 5. final_rate = index_rate + model_spread/100 + banker_adjustment/100
 * 6. Compute final_monthly_payment
 * 7. Upsert to deal_risk_pricing_model ON CONFLICT (deal_id)
 */
export async function computeRiskPricing(
  dealId: string,
): Promise<{ ok: true; data: RiskPricingModel } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    // Load latest financial snapshot
    const { data: snapRow, error: snapErr } = await (sb as any)
      .from("deal_financial_snapshots")
      .select("snapshot_json")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapErr) return { ok: false, error: `snapshot query: ${snapErr.message}` };
    if (!snapRow?.snapshot_json) return { ok: false, error: "No financial snapshot exists" };

    const snap = snapRow.snapshot_json;
    const dscr: number | null = snap.dscr?.value_num ?? null;
    const gcfDscr: number | null = snap.gcf_dscr?.value_num ?? null;
    const ltv: number | null = snap.ltv_gross?.value_num ?? null;

    if (dscr == null) {
      return { ok: false, error: "Snapshot has no DSCR — cannot grade risk" };
    }

    // Load structural pricing
    const { data: spRow, error: spErr } = await (sb as any)
      .from("deal_structural_pricing")
      .select("*")
      .eq("deal_id", dealId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (spErr) return { ok: false, error: `structural_pricing query: ${spErr.message}` };
    if (!spRow) return { ok: false, error: "No structural pricing exists" };

    const indexRate: number = spRow.index_rate_pct ?? spRow.structural_rate_pct ?? 5.0;
    const principal: number = spRow.loan_amount;
    const amortMonths: number = spRow.amort_months ?? 300;

    // Grade DSCR
    const { grade, spreadBps: dscrSpreadBps } = gradeFromDscr(dscr);
    const ltvAdj = ltvAdjustmentBps(ltv);
    const modelSpreadBps = dscrSpreadBps + ltvAdj;

    // Load existing banker adjustment (if any)
    const { data: existingModel } = await (sb as any)
      .from("deal_risk_pricing_model")
      .select("banker_adjustment_bps")
      .eq("deal_id", dealId)
      .maybeSingle();

    const bankerAdj: number = existingModel?.banker_adjustment_bps ?? 0;

    // Compute final rate
    const finalRatePct = indexRate + modelSpreadBps / 100 + bankerAdj / 100;

    // Compute final monthly payment using standard amortization
    const finalMonthly = computeMonthlyPayment(principal, finalRatePct, amortMonths);

    // Upsert to deal_risk_pricing_model
    const row = {
      deal_id: dealId,
      risk_grade: grade,
      model_spread_bps: modelSpreadBps,
      dscr: Math.round(dscr * 1000) / 1000,
      global_dscr: gcfDscr != null ? Math.round(gcfDscr * 1000) / 1000 : null,
      ltv: ltv != null ? Math.round(ltv * 10) / 10 : null,
      banker_adjustment_bps: bankerAdj,
      final_rate_pct: Math.round(finalRatePct * 10000) / 10000,
      final_monthly_payment: finalMonthly != null ? Math.round(finalMonthly * 100) / 100 : null,
      finalized: false, // Recompute always resets finalized
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await (sb as any)
      .from("deal_risk_pricing_model")
      .upsert(row, { onConflict: "deal_id" })
      .select("*")
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data as RiskPricingModel };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Apply a banker spread adjustment and recompute final rate + payment.
 */
export async function applyBankerAdjustment(
  dealId: string,
  adjustmentBps: number,
): Promise<{ ok: true; data: RiskPricingModel } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    // Load existing model
    const { data: model, error: loadErr } = await (sb as any)
      .from("deal_risk_pricing_model")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (loadErr) return { ok: false, error: loadErr.message };
    if (!model) return { ok: false, error: "No risk pricing model exists — run compute first" };

    // Load structural pricing for recomputing payment
    const { data: spRow } = await (sb as any)
      .from("deal_structural_pricing")
      .select("loan_amount, amort_months, index_rate_pct, structural_rate_pct")
      .eq("deal_id", dealId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const indexRate: number = spRow?.index_rate_pct ?? spRow?.structural_rate_pct ?? 5.0;
    const principal: number = spRow?.loan_amount ?? 0;
    const amortMonths: number = spRow?.amort_months ?? 300;

    const finalRatePct = indexRate + (model.model_spread_bps ?? 0) / 100 + adjustmentBps / 100;
    const finalMonthly = computeMonthlyPayment(principal, finalRatePct, amortMonths);

    const { data: updated, error: updErr } = await (sb as any)
      .from("deal_risk_pricing_model")
      .update({
        banker_adjustment_bps: adjustmentBps,
        final_rate_pct: Math.round(finalRatePct * 10000) / 10000,
        final_monthly_payment: finalMonthly != null ? Math.round(finalMonthly * 100) / 100 : null,
        finalized: false, // Adjustment resets finalized
        updated_at: new Date().toISOString(),
      })
      .eq("deal_id", dealId)
      .select("*")
      .single();

    if (updErr) return { ok: false, error: updErr.message };
    return { ok: true, data: updated as RiskPricingModel };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Finalize risk pricing — locks the model and emits a ledger event.
 */
export async function finalizeRiskPricing(
  dealId: string,
): Promise<{ ok: true; data: RiskPricingModel } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    const { data, error } = await (sb as any)
      .from("deal_risk_pricing_model")
      .update({
        finalized: true,
        updated_at: new Date().toISOString(),
      })
      .eq("deal_id", dealId)
      .select("*")
      .single();

    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "No risk pricing model exists" };

    // Fire-and-forget ledger event
    try {
      const { logLedgerEvent } = await import("@/lib/pipeline/logLedgerEvent");
      await logLedgerEvent({
        dealId,
        bankId: (data as any).bank_id ?? "unknown",
        eventKey: "pricing.finalized",
        uiState: "done",
        uiMessage: `Risk pricing finalized — grade ${data.risk_grade}, rate ${data.final_rate_pct}%`,
        meta: {
          risk_grade: data.risk_grade,
          model_spread_bps: data.model_spread_bps,
          banker_adjustment_bps: data.banker_adjustment_bps,
          final_rate_pct: data.final_rate_pct,
        },
      });
    } catch {
      // Ledger event is non-fatal
    }

    return { ok: true, data: data as RiskPricingModel };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Standard amortization monthly payment.
 */
function computeMonthlyPayment(
  principal: number,
  ratePct: number,
  amortMonths: number,
): number | null {
  if (!principal || principal <= 0 || !ratePct || ratePct <= 0 || amortMonths <= 0) {
    return null;
  }
  const r = ratePct / 100 / 12;
  if (r === 0) return principal / amortMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -amortMonths));
}
