import "server-only";

// src/lib/feasibility/financialViabilityAnalysis.ts
// Phase God Tier Feasibility — Financial Viability dimension (step 4/16).
// Pure function. Consumes EXISTING projections (never recomputes them) and
// evaluates whether the financials support the proposed venture.

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

  let dscrScore: DimensionScore;
  if (input.dscrYear1Base != null) {
    const dscr = input.dscrYear1Base;
    let score = 0;
    if (dscr >= 2.0) score = 95;
    else if (dscr >= 1.5) score = 85;
    else if (dscr >= 1.25) score = 70;
    else if (dscr >= 1.1) score = 45;
    else if (dscr >= 1.0) score = 25;
    else score = 10;

    if (input.dscrYear2Base != null && input.dscrYear3Base != null) {
      if (input.dscrYear2Base > dscr && input.dscrYear3Base > input.dscrYear2Base) {
        score = Math.min(100, score + 5);
      }
      if (input.dscrYear2Base < dscr) {
        score = Math.max(0, score - 5);
        flags.push({
          severity: "warning",
          dimension: "debtServiceCoverage",
          message: `DSCR declines from ${dscr.toFixed(2)}x in Year 1 to ${input.dscrYear2Base.toFixed(2)}x in Year 2. Verify revenue assumptions.`,
        });
      }
    }

    if (dscr < 1.25) {
      flags.push({
        severity: "critical",
        dimension: "debtServiceCoverage",
        message: `Year 1 DSCR of ${dscr.toFixed(2)}x is below the SBA minimum threshold of 1.25x.`,
      });
    }

    dscrScore = {
      score,
      weight: 0.3,
      dataSource: "SBA projection model — base case",
      dataAvailable: true,
      detail: `Year 1 DSCR: ${dscr.toFixed(2)}x.${
        input.dscrYear2Base != null
          ? ` Year 2: ${input.dscrYear2Base.toFixed(2)}x.`
          : ""
      }${
        input.dscrYear3Base != null
          ? ` Year 3: ${input.dscrYear3Base.toFixed(2)}x.`
          : ""
      } SBA minimum: 1.25x.`,
    };
  } else {
    dscrScore = {
      score: 0,
      weight: 0.3,
      dataSource: "Projections not available",
      dataAvailable: false,
      detail:
        "Financial projections have not been generated. DSCR cannot be evaluated.",
    };
    flags.push({
      severity: "critical",
      dimension: "debtServiceCoverage",
      message:
        "No financial projections available. Generate projections before running feasibility analysis.",
    });
  }

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
    const minimum = input.isNewBusiness ? 0.2 : 0.1;
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
      dataSource: "Sources & Uses — working capital allocation",
      dataAvailable: true,
      detail: `Working capital reserve: ${months.toFixed(1)} months of operating expenses. Recommended: 3-6 months.`,
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

  let downsideScore: DimensionScore;
  if (input.downsideDscrYear1 != null) {
    const dd = input.downsideDscrYear1;
    let score = 0;
    if (dd >= 1.25) score = 95;
    else if (dd >= 1.1) score = 75;
    else if (dd >= 1.0) score = 55;
    else if (dd >= 0.8) score = 30;
    else score = 10;

    if (dd < 1.0) {
      flags.push({
        severity: "critical",
        dimension: "downsideResilience",
        message: `In the downside scenario, DSCR falls to ${dd.toFixed(2)}x — the business cannot cover debt service if revenue underperforms.`,
      });
    }

    downsideScore = {
      score,
      weight: 0.2,
      dataSource: "Sensitivity analysis — downside scenario",
      dataAvailable: true,
      detail: `Downside DSCR: ${dd.toFixed(2)}x. The business ${
        dd >= 1.0 ? "can" : "CANNOT"
      } service its debt if revenue underperforms by 15% with 2% cost pressure.`,
    };
  } else {
    downsideScore = {
      score: 0,
      weight: 0.2,
      dataSource: "Not available",
      dataAvailable: false,
      detail: "Sensitivity analysis not available.",
    };
  }

  // ── Composite ──────────────────────────────────────────────────────

  const dimensions = [
    dscrScore,
    breakEvenScore,
    capScore,
    cashScore,
    downsideScore,
  ];
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedSum = dimensions.reduce(
    (s, d) => s + d.score * d.weight,
    0,
  );
  const overallScore = Math.round(weightedSum / totalWeight);

  const dataPoints = dimensions.length;
  const available = dimensions.filter((d) => d.dataAvailable).length;

  return {
    overallScore,
    debtServiceCoverage: dscrScore,
    breakEvenMargin: breakEvenScore,
    capitalizationAdequacy: capScore,
    cashRunway: cashScore,
    downsideResilience: downsideScore,
    dataCompleteness: available / dataPoints,
    flags,
  };
}
