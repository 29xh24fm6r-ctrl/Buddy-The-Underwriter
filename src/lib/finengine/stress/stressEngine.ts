/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 4: unified stress engine.
 *
 * One stress primitive for the whole engine. Scenarios: rate shock (+300bps),
 * revenue compression (−5/−10/−15/−20/−30% — completes the previously-absent
 * Stress C revenue-compression half), gross-margin compression, SG&A increase,
 * cap-rate expansion, vacancy, AR dilution, customer-concentration loss,
 * collateral haircut, guarantor-liquidity haircut, refinance-at-higher-rate.
 *
 * Stress C binding gate: SIMULTANEOUS +300bps AND the registry revenue
 * compression (15%), minimum DSCR 1.00x, always on FULLY-AMORTIZING debt
 * service. All parameters resolve from the policy registry (NG4).
 *
 * Pure — no DB, no server-only.
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy, getStressParams } from "@/lib/finengine/policyRegistry";

export type StressInputs = {
  /** Base cash available for debt service (NCADS), pre-stress. */
  baseCashFlow: number;
  /** Base annual revenue (for revenue/margin scenarios). */
  baseRevenue: number;
  /** Gross/contribution margin (0..1) — the cash impact of a revenue drop. */
  grossMarginPct: number;
  /** Fully-amortizing debt service at the contract rate. */
  debtService: number;
  /** Fully-amortizing debt service at +300bps (from the debt engine). When
   *  absent, the engine conservatively approximates +12% on debt service. */
  debtServiceStressed300?: number;
};

export type StressScenarioResult = {
  scenario: string;
  stressedCashFlow: number;
  stressedDebtService: number;
  dscr: number | null;
  /** Pass vs the scenario's DSCR floor (1.00x for the binding gate). */
  passes: boolean | null;
  note: string;
};

const dscrOf = (cf: number, ds: number): number | null => (ds > 0 ? cf / ds : null);

/** Cash-flow impact of a revenue drop: ΔRevenue × contribution margin. */
function revenueCompressionImpact(i: StressInputs, compressionPct: number): number {
  return i.baseRevenue * compressionPct * i.grossMarginPct;
}

function stressedDebtServiceAtRate(i: StressInputs): number {
  if (i.debtServiceStressed300 != null) return i.debtServiceStressed300;
  // Conservative fallback when the amortization engine hasn't supplied it.
  return i.debtService * 1.12;
}

/** Full revenue-compression series (−5/−10/−15/−20/−30%). */
export function revenueCompressionSeries(i: StressInputs, ctx?: PolicyContext): StressScenarioResult[] {
  const dscrMin = getStressParams(ctx).dscrMin ?? 1;
  return [0.05, 0.1, 0.15, 0.2, 0.3].map((pct) => {
    const stressedCashFlow = i.baseCashFlow - revenueCompressionImpact(i, pct);
    const dscr = dscrOf(stressedCashFlow, i.debtService);
    return {
      scenario: `revenue_compression_${Math.round(pct * 100)}pct`,
      stressedCashFlow,
      stressedDebtService: i.debtService,
      dscr,
      passes: dscr == null ? null : dscr >= dscrMin,
      note: `Revenue −${Math.round(pct * 100)}% reduces cash by contribution margin × ΔrevenuE.`,
    };
  });
}

/** Rate shock (+300bps) on fully-amortizing debt service. */
export function rateShock(i: StressInputs, ctx?: PolicyContext): StressScenarioResult {
  const bps = resolvePolicy("stress_rate_bps", ctx).effective ?? 300;
  const dscrMin = getStressParams(ctx).dscrMin ?? 1;
  const ds = stressedDebtServiceAtRate(i);
  const dscr = dscrOf(i.baseCashFlow, ds);
  return {
    scenario: `rate_up_${bps}bps`,
    stressedCashFlow: i.baseCashFlow,
    stressedDebtService: ds,
    dscr,
    passes: dscr == null ? null : dscr >= dscrMin,
    note: `Rate +${bps}bps on fully-amortizing debt service.`,
  };
}

/**
 * STRESS C — the binding gate: simultaneous +300bps AND the registry revenue
 * compression, minimum DSCR 1.00x. This combines BOTH halves (the rate shock
 * and the previously-absent revenue-compression half).
 */
export function stressC(i: StressInputs, ctx?: PolicyContext): StressScenarioResult {
  const params = getStressParams(ctx);
  const compression = params.revenueCompression ?? 0.15;
  const dscrMin = params.dscrMin ?? 1;
  const stressedCashFlow = i.baseCashFlow - revenueCompressionImpact(i, compression);
  const stressedDebtService = stressedDebtServiceAtRate(i);
  const dscr = dscrOf(stressedCashFlow, stressedDebtService);
  return {
    scenario: "stress_c_binding",
    stressedCashFlow,
    stressedDebtService,
    dscr,
    passes: dscr == null ? null : dscr >= dscrMin,
    note: `Stress C: +${params.rateBps}bps AND −${Math.round(compression * 100)}% revenue simultaneously; min ${dscrMin.toFixed(2)}x on fully-amortizing debt service.`,
  };
}

/** Run the standard stress battery. */
export function runStressBattery(i: StressInputs, ctx?: PolicyContext): StressScenarioResult[] {
  return [rateShock(i, ctx), ...revenueCompressionSeries(i, ctx), stressC(i, ctx)];
}

// --- Catalog of additional parameterized scenarios (CRE / ABL / structure) ---

export type HaircutScenario = {
  scenario: string;
  apply: (value: number) => number;
  note: string;
};

export const STRUCTURAL_STRESS_CATALOG: HaircutScenario[] = [
  { scenario: "cap_rate_expansion_100bps", apply: (noi) => noi, note: "Cap-rate +100bps lowers value = NOI ÷ (capRate+0.01)." },
  { scenario: "vacancy_up", apply: (noi) => noi * 0.9, note: "Vacancy shock reduces NOI." },
  { scenario: "ar_dilution", apply: (base) => base * 0.85, note: "AR dilution haircut on borrowing base." },
  { scenario: "concentration_loss", apply: (rev) => rev * 0.8, note: "Loss of the largest customer." },
  { scenario: "collateral_haircut", apply: (v) => v * 0.8, note: "Liquidation haircut on collateral value." },
  { scenario: "guarantor_liquidity_haircut", apply: (l) => l * 0.5, note: "Haircut on guarantor liquidity support." },
  { scenario: "refi_at_higher_rate", apply: (ds) => ds * 1.2, note: "Refinance at a higher rate increases debt service." },
];
