import "server-only";

/**
 * Phase 90 Part A — Memo-level Stress Test Table
 *
 * A lightweight, committee-facing stress module that runs 9 deterministic
 * scenarios on a deal's EBITDA + ADS + revenue, independent of the
 * model-engine stress pipeline (which operates on FinancialModel +
 * DebtInstrument[] and isn't available at memo build time).
 *
 * Assumptions (intentionally conservative + memo-appropriate):
 *   - Revenue haircuts flow 1:1 to EBITDA (committee-level simplification;
 *     does not model variable/fixed cost split).
 *   - Rate shocks are approximated as a multiplier on annual debt service
 *     (consistent with the rest of the memo's stressed DSCR handling).
 *     +200 bps ≈ ADS × 1.02, +300 bps ≈ ADS × 1.03.
 *   - Breakeven analysis assumes EBITDA flows 1:1 from revenue for the
 *     revenue-breakeven calculation when a gross margin proxy is available.
 */

export type StressScenarioAssessment = "Passes" | "Marginal" | "Fails" | "N/A";

export type StressScenarioRow = {
  key: string;
  label: string;
  revenue_haircut_pct: number;     // 0..1 (e.g. 0.10 = -10%)
  ebitda_haircut_pct: number;      // 0..1
  rate_shock_bps: number;          // e.g. 200 = +200 bps
  stressed_ebitda: number | null;
  stressed_ads: number | null;
  stressed_dscr: number | null;
  dscr_delta: number | null;       // stressed_dscr - baseline_dscr
  assessment: StressScenarioAssessment;
};

export type StressTestTable = {
  baseline_dscr: number | null;
  scenarios: StressScenarioRow[];
  breakeven_ebitda_1x: number | null;
  breakeven_ebitda_125x: number | null;
  breakeven_revenue_1x: number | null;
  revenue_cushion_pct: number | null;
  worst_case_dscr: number | null;
  narrative: string;
};

type StressInput = {
  ebitda: number | null;
  annualDebtService: number | null;
  revenue: number | null;
  /** Optional — used only for breakeven_revenue_1x if present. */
  grossMargin: number | null;
};

// Scenario definitions ordered by severity for committee review.
type ScenarioDef = {
  key: string;
  label: string;
  revenueHaircut: number;
  ebitdaHaircut: number;
  rateShockBps: number;
};

const SCENARIOS: ScenarioDef[] = [
  { key: "BASELINE",             label: "Baseline",                       revenueHaircut: 0,    ebitdaHaircut: 0,    rateShockBps: 0 },
  { key: "REVENUE_10_DOWN",      label: "Revenue -10%",                   revenueHaircut: 0.10, ebitdaHaircut: 0,    rateShockBps: 0 },
  { key: "REVENUE_20_DOWN",      label: "Revenue -20%",                   revenueHaircut: 0.20, ebitdaHaircut: 0,    rateShockBps: 0 },
  { key: "REVENUE_30_DOWN",      label: "Revenue -30%",                   revenueHaircut: 0.30, ebitdaHaircut: 0,    rateShockBps: 0 },
  { key: "EBITDA_10_DOWN",       label: "EBITDA -10%",                    revenueHaircut: 0,    ebitdaHaircut: 0.10, rateShockBps: 0 },
  { key: "EBITDA_20_DOWN",       label: "EBITDA -20%",                    revenueHaircut: 0,    ebitdaHaircut: 0.20, rateShockBps: 0 },
  { key: "RATE_PLUS_200",        label: "Rate +200bps",                   revenueHaircut: 0,    ebitdaHaircut: 0,    rateShockBps: 200 },
  { key: "RATE_PLUS_300",        label: "Rate +300bps",                   revenueHaircut: 0,    ebitdaHaircut: 0,    rateShockBps: 300 },
  { key: "COMBINED_REV10_RATE200", label: "Revenue -10% + Rate +200bps",  revenueHaircut: 0.10, ebitdaHaircut: 0,    rateShockBps: 200 },
];

function assess(stressedDscr: number | null): StressScenarioAssessment {
  if (stressedDscr === null || !Number.isFinite(stressedDscr)) return "N/A";
  if (stressedDscr >= 1.25) return "Passes";
  if (stressedDscr >= 1.0) return "Marginal";
  return "Fails";
}

function buildNarrative(args: {
  baselineDscr: number | null;
  ebitda: number | null;
  revenue: number | null;
  breakevenEbitda125x: number | null;
  revenueCushionPct: number | null;
  worstCaseDscr: number | null;
  worstCaseLabel: string | null;
}): string {
  const {
    baselineDscr,
    ebitda,
    breakevenEbitda125x,
    revenueCushionPct,
    worstCaseDscr,
    worstCaseLabel,
  } = args;

  const parts: string[] = [];

  if (baselineDscr !== null && ebitda !== null && breakevenEbitda125x !== null && revenueCushionPct !== null) {
    if (revenueCushionPct > 0) {
      parts.push(
        `Revenue (or EBITDA) can decline approximately ${revenueCushionPct.toFixed(1)}% before DSCR breaches the 1.25x policy floor.`,
      );
    } else {
      parts.push(
        `EBITDA is already at or below the 1.25x breakeven threshold — no meaningful cushion before policy breach.`,
      );
    }
  }

  if (worstCaseDscr !== null && worstCaseLabel) {
    if (worstCaseDscr < 1.0) {
      parts.push(`Worst-case scenario (${worstCaseLabel}) drops DSCR to ${worstCaseDscr.toFixed(2)}x — below 1.0x coverage floor.`);
    } else if (worstCaseDscr < 1.25) {
      parts.push(`Worst-case scenario (${worstCaseLabel}) yields DSCR of ${worstCaseDscr.toFixed(2)}x — marginal coverage under stress.`);
    } else {
      parts.push(`All stress scenarios maintain DSCR at or above the 1.25x institutional minimum (worst: ${worstCaseDscr.toFixed(2)}x under ${worstCaseLabel}).`);
    }
  }

  if (parts.length === 0) {
    return "Insufficient inputs to run stress analysis.";
  }
  return parts.join(" ");
}

export function buildStressTestTable(input: StressInput): StressTestTable {
  const { ebitda, annualDebtService, revenue, grossMargin } = input;

  // Baseline DSCR
  const baselineDscr =
    ebitda !== null && annualDebtService !== null && annualDebtService > 0
      ? ebitda / annualDebtService
      : null;

  // Scenarios
  const scenarios: StressScenarioRow[] = SCENARIOS.map((def) => {
    // Revenue haircut flows 1:1 to EBITDA (see file header assumption).
    const totalHaircut = 1 - (1 - def.revenueHaircut) * (1 - def.ebitdaHaircut);
    const stressedEbitda =
      ebitda !== null ? ebitda * (1 - totalHaircut) : null;

    // Rate shock: multiplier on ADS (1 bp ≈ 0.0001 on the ADS multiplier).
    const adsMultiplier = 1 + def.rateShockBps / 10_000;
    const stressedAds =
      annualDebtService !== null ? annualDebtService * adsMultiplier : null;

    const stressedDscr =
      stressedEbitda !== null && stressedAds !== null && stressedAds > 0
        ? stressedEbitda / stressedAds
        : null;

    const dscrDelta =
      stressedDscr !== null && baselineDscr !== null
        ? stressedDscr - baselineDscr
        : null;

    return {
      key: def.key,
      label: def.label,
      revenue_haircut_pct: def.revenueHaircut,
      ebitda_haircut_pct: def.ebitdaHaircut,
      rate_shock_bps: def.rateShockBps,
      stressed_ebitda: stressedEbitda,
      stressed_ads: stressedAds,
      stressed_dscr: stressedDscr,
      dscr_delta: dscrDelta,
      assessment: assess(stressedDscr),
    };
  });

  // Breakeven analysis
  const breakevenEbitda1x = annualDebtService;
  const breakevenEbitda125x =
    annualDebtService !== null ? annualDebtService * 1.25 : null;

  // Revenue cushion %: how much EBITDA can drop before hitting 1.25x threshold.
  // Not expressed in revenue terms because revenue→EBITDA requires a cost model.
  const revenueCushionPct =
    ebitda !== null && ebitda > 0 && breakevenEbitda125x !== null
      ? ((ebitda - breakevenEbitda125x) / ebitda) * 100
      : null;

  // Implied revenue at 1.0x DSCR — only meaningful if we have a gross margin
  // proxy to translate EBITDA → revenue.
  const breakevenRevenue1x =
    breakevenEbitda1x !== null && grossMargin !== null && grossMargin > 0
      ? breakevenEbitda1x / grossMargin
      : null;

  // Worst case (excluding BASELINE)
  const stressedOnly = scenarios.filter((s) => s.key !== "BASELINE");
  let worstCaseDscr: number | null = null;
  let worstCaseLabel: string | null = null;
  for (const s of stressedOnly) {
    if (s.stressed_dscr === null) continue;
    if (worstCaseDscr === null || s.stressed_dscr < worstCaseDscr) {
      worstCaseDscr = s.stressed_dscr;
      worstCaseLabel = s.label;
    }
  }

  const narrative = buildNarrative({
    baselineDscr,
    ebitda,
    revenue,
    breakevenEbitda125x,
    revenueCushionPct,
    worstCaseDscr,
    worstCaseLabel,
  });

  return {
    baseline_dscr: baselineDscr,
    scenarios,
    breakeven_ebitda_1x: breakevenEbitda1x,
    breakeven_ebitda_125x: breakevenEbitda125x,
    breakeven_revenue_1x: breakevenRevenue1x,
    revenue_cushion_pct: revenueCushionPct,
    worst_case_dscr: worstCaseDscr,
    narrative,
  };
}
