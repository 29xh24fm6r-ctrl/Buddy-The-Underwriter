import "server-only";

// src/lib/feasibility/financialViabilityAnalysis.ts
// Phase God Tier Feasibility — Financial Viability dimension (step 4/16).
// Pure function. Consumes EXISTING projections (never recomputes them) and
// evaluates whether the financials support the proposed venture.

import { forecastCoverage } from "@/lib/sba/forecastCoverage";
import { computeDimensionCompleteness } from "./dimensionCompleteness";
import type {
  DimensionScore,
  FinancialViabilityInput,
  FinancialViabilityScore,
  MarketFlag,
} from "./types";

export function analyzeFinancialViability(
  input: FinancialViabilityInput,
): FinancialViabilityScore {
  const flags: MarketFlag[] = [];

  // ── DSCR Coverage ──────────────────────────────────────────────────

  const base = forecastCoverage([input.dscrYear1Base, input.dscrYear2Base, input.dscrYear3Base], input.projectedDscrThreshold);
  let baseScore = 0;
  if (base.complete && base.minimum !== null) {
    const dscr = base.minimum;
    baseScore = dscr >= 2 ? 95 : dscr >= 1.5 ? 85 : dscr >= 1.25 ? 70 : dscr >= 1.1 ? 45 : dscr >= 1 ? 25 : 10;
    if (base.increasing && !base.belowThreshold.length) baseScore = Math.min(100, baseScore + 5);
    if (base.declining) baseScore = Math.max(0, baseScore - 5);
    if (base.belowThreshold.length) baseScore = Math.min(baseScore, 45);
  }
  if (base.belowThreshold.length || !base.complete) {
    flags.push({ severity: "critical", dimension: "debtServiceCoverage", message: [
      base.belowThreshold.length ? `Base-case coverage is below the model's ${input.projectedDscrThreshold.toFixed(2)}x threshold in ${base.failures}.` : "",
      base.belowDebtService.length ? `Projected cash flow cannot cover debt service in ${base.shortfalls}.` : "",
      !base.complete ? `Base-case coverage is missing for ${base.missing.join(", ")}; the three-year forecast cannot be fully evaluated.` : "",
    ].filter(Boolean).join(" ") });
  } else if (base.declining) {
    flags.push({ severity: "warning", dimension: "debtServiceCoverage",
      message: `Base-case DSCR declines within the forecast: ${base.path}. Verify revenue assumptions.` });
  }
  const dscrScore: DimensionScore = {
    score: baseScore, weight: 0.3, dataSource: "SBA projection model — three-year base case",
    dataAvailable: base.complete,
    detail: `${base.path}. Model coverage threshold: ${input.projectedDscrThreshold.toFixed(2)}x. ${base.complete ? "Score reflects the weakest forecast year and the coverage trend." : "Incomplete forecast; full-horizon coverage is not established."}`,
  };

  // ── Break-Even Margin ──────────────────────────────────────────────

  let breakEvenScore: DimensionScore;
  if (input.marginOfSafetyPct != null) {
    const mos = input.marginOfSafetyPct;
    let score = 0;
    if (mos >= 0.4) score = 95;
    else if (mos >= 0.25) score = 80;
    else if (mos >= 0.15) score = 65;
    else if (mos >= 0.1) score = 50;
    else if (mos >= 0.05) score = 30;
    else score = 15;

    if (mos < 0.1) {
      flags.push({
        severity: "warning",
        dimension: "breakEvenMargin",
        message: `Margin of safety is ${(mos * 100).toFixed(1)}% — less than 10% cushion above break-even.`,
      });
    }

    breakEvenScore = {
      score,
      weight: 0.2,
      dataSource: "SBA projection model — break-even analysis",
      dataAvailable: true,
      detail: `Margin of safety: ${(mos * 100).toFixed(1)}%. Projected revenue exceeds break-even by $${
        input.projectedRevenueYear1 != null && input.breakEvenRevenue != null
          ? Math.round(
              input.projectedRevenueYear1 - input.breakEvenRevenue,
            ).toLocaleString()
          : "N/A"
      }.`,
    };
  } else {
    breakEvenScore = {
      score: 0,
      weight: 0.2,
      dataSource: "Not available",
      dataAvailable: false,
      detail: "Break-even analysis not available.",
    };
  }

  // ── Capitalization Adequacy ────────────────────────────────────────

  let capScore: DimensionScore;
  if (input.equityInjectionPct != null) {
    const equity = input.equityInjectionPct;
    const minimum = input.equityInjectionFloor;
    let score = 0;
    if (equity >= minimum * 2) score = 95;
    else if (equity >= minimum * 1.5) score = 80;
    else if (equity >= minimum) score = 65;
    else if (equity >= minimum * 0.8) score = 35;
    else score = 15;

    if (equity < minimum) {
      flags.push({
        severity: "critical",
        dimension: "capitalizationAdequacy",
        message: `Equity injection of ${(equity * 100).toFixed(1)}% is below SBA minimum of ${(minimum * 100).toFixed(0)}%.`,
      });
    }

    capScore = {
      score,
      weight: 0.15,
      dataSource: "Sources & Uses analysis",
      dataAvailable: true,
      detail: `Equity injection: ${(equity * 100).toFixed(1)}%. Minimum required: ${(minimum * 100).toFixed(0)}% (${
        input.isNewBusiness ? "new business" : "existing business"
      }).`,
    };
  } else {
    capScore = {
      score: 0,
      weight: 0.15,
      dataSource: "Not available",
      dataAvailable: false,
      detail: "Equity injection data not available.",
    };
  }

  // ── Cash Runway ────────────────────────────────────────────────────

  let cashScore: DimensionScore;
  if (input.workingCapitalReserveMonths != null) {
    const months = input.workingCapitalReserveMonths;
    let score = 0;
    if (months >= 6) score = 95;
    else if (months >= 4) score = 80;
    else if (months >= 3) score = 65;
    else if (months >= 2) score = 40;
    else score = 20;

    if (months < 3) {
      flags.push({
        severity: "warning",
        dimension: "cashRunway",
        message: `Working capital reserve of ${months.toFixed(1)} months is below the recommended 3-month minimum.`,
      });
    }

    cashScore = {
      score,
      weight: 0.15,
      dataSource: "Reconciled Sources & Uses and projected year-one cash operating costs",
      dataAvailable: true,
      detail: `Planned working capital reserve coverage: ${months.toFixed(1)} months of projected COGS and operating expenses, before debt service. This is a planning assumption, not verified cash on hand. Recommended: 3-6 months.`,
    };
  } else {
    cashScore = {
      score: 50,
      weight: 0.15,
      dataSource: "Not specified",
      dataAvailable: false,
      detail: "Working capital reserve not explicitly budgeted.",
    };
  }

  // ── Downside Resilience ────────────────────────────────────────────

  const downside = forecastCoverage([input.downsideDscrYear1, input.downsideDscrYear2, input.downsideDscrYear3], input.projectedDscrThreshold);
  let resilienceScore = 0;
  if (downside.complete && downside.minimum !== null) {
    const dd = downside.minimum;
    resilienceScore = dd >= 1.25 ? 95 : dd >= 1.1 ? 75 : dd >= 1 ? 55 : dd >= 0.8 ? 30 : 10;
    if (downside.belowThreshold.length) resilienceScore = Math.min(resilienceScore, 55);
  }
  // One flag describes the scenario, not a separate critical risk per year.
  if (downside.belowThreshold.length || !downside.complete) {
    flags.push({ severity: "critical", dimension: "downsideResilience", message: [
      downside.belowThreshold.length ? `Saved downside coverage is below the model's ${input.projectedDscrThreshold.toFixed(2)}x threshold in ${downside.failures}.` : "",
      downside.belowDebtService.length ? `Projected cash flow cannot cover debt service in ${downside.shortfalls}.` : "",
      !downside.complete ? `Downside coverage is missing for ${downside.missing.join(", ")}; resilience across the three-year forecast is not established.` : "",
    ].filter(Boolean).join(" ") });
  }
  const downsideConclusion = downside.belowDebtService.length
    ? `The saved downside scenario cannot cover debt service in ${downside.shortfalls}.`
    : downside.belowThreshold.length
      ? `The saved downside scenario falls below the model's ${input.projectedDscrThreshold.toFixed(2)}x threshold in ${downside.failures}.`
      : downside.complete
        ? `The saved downside scenario meets the model's ${input.projectedDscrThreshold.toFixed(2)}x threshold in all three years; this remains a conditional projection.`
        : "Full-horizon downside resilience is not established.";
  const downsideScore: DimensionScore = {
    score: resilienceScore, weight: 0.2, dataSource: "Sensitivity analysis — three-year downside scenario",
    dataAvailable: downside.complete,
    detail: `Downside DSCR: ${downside.path}. ${downsideConclusion}${!downside.complete ? ` Missing coverage: ${downside.missing.join(", ")}.` : " Score reflects the weakest forecast year."}`,
  };

  // ── Composite ──────────────────────────────────────────────────────

  const entries = [
    { key: "debtServiceCoverage", score: dscrScore },
    { key: "breakEvenMargin", score: breakEvenScore },
    { key: "capitalizationAdequacy", score: capScore },
    { key: "cashRunway", score: cashScore },
    { key: "downsideResilience", score: downsideScore },
  ];
  const dimensions = entries.map((e) => e.score);
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedSum = dimensions.reduce(
    (s, d) => s + d.score * d.weight,
    0,
  );
  const overallScore = Math.round(weightedSum / totalWeight);

  const coverage = computeDimensionCompleteness(entries);

  return {
    overallScore,
    debtServiceCoverage: dscrScore,
    breakEvenMargin: breakEvenScore,
    capitalizationAdequacy: capScore,
    cashRunway: cashScore,
    downsideResilience: downsideScore,
    dataCompleteness: coverage.completeness,
    coverage,
    flags,
  };
}
