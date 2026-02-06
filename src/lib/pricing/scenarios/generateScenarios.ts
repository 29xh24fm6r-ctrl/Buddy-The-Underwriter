import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getLatestIndexRates, type IndexCode, type IndexRate } from "@/lib/rates/indexRates";
import { evaluateSbaEligibility } from "@/lib/sba/eligibilityEngine";
import type { DealFinancialSnapshotV1, SnapshotMetricValue } from "@/lib/deals/financialSnapshotCore";
import { logPipelineLedger } from "@/lib/pipeline/logPipelineLedger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScenarioKey = "BASE" | "CONSERVATIVE" | "STRETCH" | "SBA_7A";

export type PricingStructure = {
  index_code: IndexCode;
  base_rate_pct: number;
  spread_bps: number;
  all_in_rate_pct: number;
  loan_amount: number;
  term_months: number;
  amort_months: number;
  interest_only_months: number;
  fees: { origination_pct: number; sba_guaranty_fee_pct?: number };
  prepayment: { type: string; penalty_pct?: number };
  guaranty: string;
};

export type PricingMetrics = {
  dscr: number | null;
  dscr_stressed_300bps: number | null;
  ltv_pct: number | null;
  debt_yield_pct: number | null;
  annual_debt_service: number | null;
  monthly_pi: number | null;
  monthly_io: number | null;
  global_cf_impact: number | null;
};

export type PolicyOverlay = {
  source: string;
  section?: string;
  rule: string;
  applied: boolean;
  impact?: string;
};

export type GeneratedScenario = {
  scenario_key: ScenarioKey;
  product_type: string;
  structure: PricingStructure;
  metrics: PricingMetrics;
  policy_overlays: PolicyOverlay[];
};

export type GenerateScenariosResult =
  | { ok: true; scenarios: GeneratedScenario[]; snapshotId: string }
  | { ok: false; error: string; status: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: SnapshotMetricValue | null | undefined): number | null {
  if (!v) return null;
  return typeof v.value_num === "number" ? v.value_num : null;
}

function monthlyPI(principal: number, annualRatePct: number, nMonths: number): number | null {
  const r = annualRatePct / 100 / 12;
  if (nMonths <= 0) return null;
  if (r === 0) return principal / nMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -nMonths));
}

function annualDebtService(principal: number, annualRatePct: number, amortMonths: number): number | null {
  const pi = monthlyPI(principal, annualRatePct, amortMonths);
  return pi ? pi * 12 : null;
}

function computeDscr(cashFlow: number | null, ads: number | null): number | null {
  if (!cashFlow || !ads || ads === 0) return null;
  return cashFlow / ads;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function generatePricingScenarios(args: {
  dealId: string;
  bankId: string;
}): Promise<GenerateScenariosResult> {
  const sb = supabaseAdmin();

  // 1. Load latest financial snapshot
  const { data: snapRow, error: snapErr } = await sb
    .from("financial_snapshots")
    .select("id, snapshot_json, snapshot_hash")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapErr || !snapRow) {
    return { ok: false, error: "no_financial_snapshot", status: 422 };
  }

  const snapshot = snapRow.snapshot_json as DealFinancialSnapshotV1;
  const snapshotId = snapRow.id as string;

  // 2. Check for active spread jobs (409 if generating)
  const { count: activeJobs } = await sb
    .from("deal_spread_jobs")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .in("status", ["pending", "running"]);

  if (activeJobs && activeJobs > 0) {
    return { ok: false, error: "spreads_still_generating", status: 409 };
  }

  // 3. Load loan request
  const { data: loanReq } = await sb
    .from("deal_loan_requests")
    .select("*")
    .eq("deal_id", args.dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!loanReq) {
    return { ok: false, error: "no_loan_request", status: 422 };
  }

  // 4. Load live rates
  let rates: Record<IndexCode, IndexRate>;
  try {
    rates = await getLatestIndexRates();
  } catch {
    return { ok: false, error: "rate_feed_unavailable", status: 502 };
  }

  // 5. Load bank overlays
  const { data: overlayRow } = await sb
    .from("bank_overlays")
    .select("overlay_json")
    .eq("bank_id", args.bankId)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const bankOverlay = (overlayRow?.overlay_json as Record<string, any>) ?? {};

  // 6. SBA eligibility
  const sba = evaluateSbaEligibility({
    snapshot,
    borrowerEntityType: null,
    useOfProceeds: loanReq.use_of_proceeds as string[] | null,
    dealType: null,
    loanProductType: loanReq.product_type,
  });

  // 7. Extract snapshot metrics
  const noi = toNum(snapshot.noi_ttm);
  const cashFlowAvailable = toNum(snapshot.cash_flow_available) ?? noi;
  const collateralValue = toNum(snapshot.collateral_gross_value);
  const gcf = toNum((snapshot as any).gcf_global_cash_flow);

  // 8. Derive base loan parameters
  const loanAmount = Number(loanReq.requested_amount ?? loanReq.approved_amount ?? 0);
  const termMonths = Number(loanReq.requested_term_months ?? 120);
  const amortMonths = Number(loanReq.requested_amort_months ?? 300);
  const ioMonths = Number(loanReq.requested_interest_only_months ?? 0);
  const productType = String(loanReq.product_type ?? "CONVENTIONAL");
  const indexCode: IndexCode = (loanReq.requested_rate_index as IndexCode) ?? "SOFR";
  const baseRatePct = rates[indexCode]?.ratePct ?? rates.SOFR?.ratePct ?? 5.0;

  // 9. Policy constraints
  const minDscr = Number(bankOverlay.min_dscr ?? 1.25);
  const maxLtv = Number(bankOverlay.max_ltv ?? 0.80);
  const baseSpreadBps = Number(bankOverlay.base_spread_bps ?? 250);
  const conservativeSpreadBps = baseSpreadBps + 50;
  const stretchSpreadBps = Math.max(baseSpreadBps - 50, 100);

  // 10. Build scenarios
  function buildScenario(
    key: ScenarioKey,
    spreadBps: number,
    product: string,
    adjustments: Partial<{ amortMonths: number; termMonths: number; ioMonths: number; loanAmount: number; guaranty: string }>,
  ): GeneratedScenario {
    const adjLoanAmount = adjustments.loanAmount ?? loanAmount;
    const adjAmort = adjustments.amortMonths ?? amortMonths;
    const adjTerm = adjustments.termMonths ?? termMonths;
    const adjIo = adjustments.ioMonths ?? ioMonths;
    const guaranty = adjustments.guaranty ?? "Full personal guaranty required";

    const allInRatePct = baseRatePct + spreadBps / 100;
    const ads = annualDebtService(adjLoanAmount, allInRatePct, adjAmort);
    const pi = monthlyPI(adjLoanAmount, allInRatePct, adjAmort);
    const io = adjLoanAmount * (allInRatePct / 100 / 12);

    const dscr = computeDscr(cashFlowAvailable, ads);
    const stressedRate = allInRatePct + 3.0;
    const stressedAds = annualDebtService(adjLoanAmount, stressedRate, adjAmort);
    const dscrStressed = computeDscr(cashFlowAvailable, stressedAds);

    const ltvPct = collateralValue && collateralValue > 0 ? adjLoanAmount / collateralValue : null;
    const debtYieldPct = noi && adjLoanAmount > 0 ? noi / adjLoanAmount : null;

    const overlays: PolicyOverlay[] = [];

    // Bank policy overlays
    if (dscr !== null && dscr < minDscr) {
      overlays.push({
        source: "Bank Credit Policy",
        rule: `Min DSCR ${minDscr.toFixed(2)}x`,
        applied: true,
        impact: `Actual DSCR ${dscr.toFixed(2)}x is below policy minimum — exception required`,
      });
    }
    if (ltvPct !== null && ltvPct > maxLtv) {
      overlays.push({
        source: "Bank Credit Policy",
        rule: `Max LTV ${(maxLtv * 100).toFixed(0)}%`,
        applied: true,
        impact: `Actual LTV ${(ltvPct * 100).toFixed(1)}% exceeds policy limit`,
      });
    }

    // SBA overlays
    if (product.startsWith("SBA")) {
      overlays.push({
        source: "SBA SOP 50 10",
        section: "7(a) General",
        rule: "SBA eligibility check",
        applied: true,
        impact: `Status: ${sba.status}${sba.reasons.length ? ` — ${sba.reasons[0]}` : ""}`,
      });
      if (sba.status === "eligible" || sba.status === "conditional") {
        overlays.push({
          source: "SBA SOP 50 10",
          section: "7(a) Fees",
          rule: "Guaranty fee schedule applies",
          applied: true,
          impact: adjLoanAmount <= 1_000_000
            ? "0.25% (loans ≤ $1M) per SBA fee schedule"
            : "3.50% (loans > $1M) per SBA fee schedule",
        });
      }
    }

    const sbaGuarantyFeePct = product.startsWith("SBA")
      ? (adjLoanAmount <= 1_000_000 ? 0.25 : 3.5)
      : undefined;

    const structure: PricingStructure = {
      index_code: indexCode,
      base_rate_pct: baseRatePct,
      spread_bps: spreadBps,
      all_in_rate_pct: allInRatePct,
      loan_amount: adjLoanAmount,
      term_months: adjTerm,
      amort_months: adjAmort,
      interest_only_months: adjIo,
      fees: {
        origination_pct: product.startsWith("SBA") ? 0.5 : 1.0,
        sba_guaranty_fee_pct: sbaGuarantyFeePct,
      },
      prepayment: product.startsWith("SBA")
        ? { type: "SBA Standard", penalty_pct: 5 }
        : { type: "Step-down", penalty_pct: 3 },
      guaranty,
    };

    const metrics: PricingMetrics = {
      dscr,
      dscr_stressed_300bps: dscrStressed,
      ltv_pct: ltvPct,
      debt_yield_pct: debtYieldPct,
      annual_debt_service: ads,
      monthly_pi: pi,
      monthly_io: adjIo > 0 ? io : null,
      global_cf_impact: gcf,
    };

    return { scenario_key: key, product_type: product, structure, metrics, policy_overlays: overlays };
  }

  const scenarios: GeneratedScenario[] = [];

  // BASE scenario
  scenarios.push(buildScenario("BASE", baseSpreadBps, productType, {}));

  // CONSERVATIVE scenario — wider spread, shorter amort
  scenarios.push(buildScenario("CONSERVATIVE", conservativeSpreadBps, productType, {
    amortMonths: Math.min(amortMonths, 240),
    guaranty: "Full personal guaranty with additional collateral pledge",
  }));

  // STRETCH scenario — tighter spread (for strong deals)
  if (cashFlowAvailable && noi && toNum(snapshot.dscr)! >= minDscr) {
    scenarios.push(buildScenario("STRETCH", stretchSpreadBps, productType, {
      guaranty: "Limited personal guaranty",
    }));
  }

  // SBA_7A scenario — if eligible
  if (sba.status !== "ineligible" && !productType.startsWith("SBA")) {
    scenarios.push(buildScenario("SBA_7A", 275, "SBA_7A", {
      amortMonths: 300,
      termMonths: 120,
      guaranty: "SBA standard guaranty (75%)",
    }));
  }

  // 11. Delete old scenarios for this deal (idempotent regeneration)
  // Must delete decisions first (FK cascade), then scenarios
  await sb.from("pricing_decisions").delete().eq("deal_id", args.dealId);
  await sb.from("pricing_scenarios").delete().eq("deal_id", args.dealId);

  // 12. Insert new scenarios
  const rows = scenarios.map((s) => ({
    deal_id: args.dealId,
    bank_id: args.bankId,
    financial_snapshot_id: snapshotId,
    loan_request_id: loanReq.id,
    scenario_key: s.scenario_key,
    product_type: s.product_type,
    structure: s.structure,
    metrics: s.metrics,
    policy_overlays: s.policy_overlays,
  }));

  const { error: insertErr } = await sb.from("pricing_scenarios").insert(rows);
  if (insertErr) {
    return { ok: false, error: `insert_failed: ${insertErr.message}`, status: 500 };
  }

  // 13. Emit ledger event
  await logPipelineLedger(sb, {
    bank_id: args.bankId,
    deal_id: args.dealId,
    event_key: "pricing.scenarios.generated",
    status: "ok",
    payload: {
      snapshotId,
      scenarioCount: scenarios.length,
      keys: scenarios.map((s) => s.scenario_key),
      loanRequestId: loanReq.id,
    },
  });

  return { ok: true, scenarios, snapshotId };
}
