/**
 * SPEC-FINENGINE god-tier improvement C — forward projections engine.
 *
 * The stress engine answers "what if the world shocks today?"; this answers the
 * other half an elite committee asks: "where does coverage go over the term?".
 * Given a base year (revenue + EBITDA), a debt profile, and forward assumptions
 * (revenue growth, margin drift, capex intensity, a rate path), it projects
 * revenue → EBITDA → cash-available → DSCR and the COVENANT HEADROOM by year,
 * flagging the first year coverage breaches the policy floor.
 *
 * Deterministic and pure — same assumptions, same projection. The DSCR covenant
 * floor resolves from the policy registry (NG4). No DB, no LLM (NG5).
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

export type ProjectionAssumptions = {
  years: number; // projection horizon (e.g. 5)
  revenueGrowth: number; // annual revenue growth, e.g. 0.05 = +5%/yr
  /** Starting EBITDA margin; defaults to base EBITDA ÷ base revenue. */
  ebitdaMarginStart?: number;
  /** Annual additive change in EBITDA margin (e.g. -0.005 = 50bps compression/yr). */
  ebitdaMarginDrift?: number;
  /** Capex as a fraction of revenue (subtracted to reach cash available). */
  capexPctOfRevenue?: number;
  /** Per-year incremental rate change in bps applied to the floating debt balance. */
  ratePathBps?: number[];
};

export type DebtProfile = {
  /** Base annual debt service (P&I) before any rate-path adjustment. */
  annualDebtService: number;
  /** Outstanding balance used for rate sensitivity (defaults to 0 → rate-insensitive). */
  outstandingBalance?: number;
  /** Fraction of the balance on a floating rate (0..1). */
  floatingShareOfBalance?: number;
};

export type ProjectionYear = {
  year: number; // 1-based
  revenue: number;
  ebitdaMargin: number;
  ebitda: number;
  capex: number;
  cashAvailableForDebtService: number; // EBITDA − capex (conservative pre-debt FCF proxy)
  debtService: number;
  dscr: number | null;
  covenantFloor: number | null;
  headroom: number | null; // dscr − floor (negative = breach)
  passes: boolean | null;
};

export type ProjectionResult = {
  years: ProjectionYear[];
  covenantFloor: number | null;
  minDscr: number | null;
  minDscrYear: number | null;
  firstBreachYear: number | null; // first year DSCR < floor, or null if never
  passesAllYears: boolean;
  assumptions: ProjectionAssumptions;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Project coverage forward. `cashAvailableForDebtService = EBITDA − capex` is a
 * conservative pre-debt cash proxy; callers with a fuller UCA waterfall can pass
 * a higher base EBITDA. Rate-path interest = balance × floatingShare ×
 * (cumulative bps ÷ 10,000), added to the base debt service (non-amortizing
 * approximation, documented).
 */
export function projectForward(
  base: { revenue: number; ebitda: number },
  debt: DebtProfile,
  a: ProjectionAssumptions,
  ctx?: PolicyContext,
): ProjectionResult {
  const floor = resolvePolicy("dscr_floor", ctx).effective ?? null;
  const startMargin = a.ebitdaMarginStart ?? (base.revenue !== 0 ? base.ebitda / base.revenue : 0);
  const drift = a.ebitdaMarginDrift ?? 0;
  const capexPct = a.capexPctOfRevenue ?? 0;
  const balance = debt.outstandingBalance ?? 0;
  const floatingShare = debt.floatingShareOfBalance ?? 0;

  const years: ProjectionYear[] = [];
  let cumulativeBps = 0;

  for (let y = 1; y <= a.years; y++) {
    const revenue = base.revenue * Math.pow(1 + a.revenueGrowth, y);
    const ebitdaMargin = startMargin + drift * y;
    const ebitda = revenue * ebitdaMargin;
    const capex = revenue * capexPct;
    const cashAvail = ebitda - capex;

    cumulativeBps += a.ratePathBps?.[y - 1] ?? 0;
    const rateAddon = balance * floatingShare * (cumulativeBps / 10_000);
    const debtService = debt.annualDebtService + rateAddon;

    const dscr = debtService === 0 ? null : cashAvail / debtService;
    const headroom = dscr == null || floor == null ? null : dscr - floor;
    const passes = dscr == null || floor == null ? null : dscr >= floor;

    years.push({
      year: y,
      revenue: Math.round(revenue),
      ebitdaMargin: round2(ebitdaMargin * 100) / 100,
      ebitda: Math.round(ebitda),
      capex: Math.round(capex),
      cashAvailableForDebtService: Math.round(cashAvail),
      debtService: Math.round(debtService),
      dscr: dscr == null ? null : round2(dscr),
      covenantFloor: floor,
      headroom: headroom == null ? null : round2(headroom),
      passes,
    });
  }

  const dscrs = years.map((y) => y.dscr).filter((d): d is number => d != null);
  const minDscr = dscrs.length ? Math.min(...dscrs) : null;
  const minDscrYear = minDscr == null ? null : years.find((y) => y.dscr === minDscr)?.year ?? null;
  const firstBreachYear = years.find((y) => y.passes === false)?.year ?? null;

  return {
    years,
    covenantFloor: floor,
    minDscr,
    minDscrYear,
    firstBreachYear,
    passesAllYears: years.every((y) => y.passes !== false),
    assumptions: a,
  };
}
