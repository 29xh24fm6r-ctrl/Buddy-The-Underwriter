import "server-only";

// src/lib/feasibility/marketDemandAnalysis.ts
// Phase God Tier Feasibility — Market Demand dimension (step 3/16).
// Pure function. No DB, no LLM. Quantifies whether sufficient demand
// exists for the proposed business at the proposed location.

import type {
  DimensionScore,
  MarketDemandInput,
  MarketDemandScore,
  MarketFlag,
} from "./types";

export function analyzeMarketDemand(
  input: MarketDemandInput,
): MarketDemandScore {
  const flags: MarketFlag[] = [];
  let dataPoints = 0;
  let dataAvailable = 0;

  // ── Population Adequacy ────────────────────────────────────────────

  dataPoints++;
  let populationScore: DimensionScore;

  if (input.tradeArea?.populationRadius5mi != null) {
    dataAvailable++;
    const pop = input.tradeArea.populationRadius5mi;

    if (input.franchise?.minimumPopulationRequired) {
      const ratio = pop / input.franchise.minimumPopulationRequired;
      const score = Math.min(100, Math.round(ratio * 80));
      populationScore = {
        score,
        weight: 0.3,
        dataSource: "Census trade area + franchise territory requirements",
        dataAvailable: true,
        detail: `Trade area population: ${pop.toLocaleString()}. Brand minimum: ${input.franchise.minimumPopulationRequired.toLocaleString()}. Ratio: ${ratio.toFixed(2)}x.`,
      };
      if (ratio < 1.0) {
        flags.push({
          severity: "critical",
          dimension: "populationAdequacy",
          message: `Trade area population (${pop.toLocaleString()}) is below the brand's minimum requirement (${input.franchise.minimumPopulationRequired.toLocaleString()}).`,
        });
      }
    } else {
      const revenuePerCapita =
        input.projectedAnnualRevenue != null
          ? input.projectedAnnualRevenue / pop
          : null;

      let score = 70;
      if (pop > 100_000) score = 85;
      if (pop > 250_000) score = 90;
      if (pop < 10_000) score = 40;
      if (pop < 5_000) score = 20;

      if (revenuePerCapita != null && revenuePerCapita > 50) {
        score = Math.max(score - 20, 10);
        flags.push({
          severity: "warning",
          dimension: "populationAdequacy",
          message: `Projected revenue requires $${revenuePerCapita.toFixed(0)} per capita in the trade area — this is high for most consumer businesses.`,
        });
      }

      populationScore = {
        score,
        weight: 0.3,
        dataSource: "Census trade area population",
        dataAvailable: true,
        detail: `5-mile trade area population: ${pop.toLocaleString()}.${
          revenuePerCapita != null
            ? ` Revenue per capita: $${revenuePerCapita.toFixed(0)}.`
            : ""
        }`,
      };
    }
  } else {
    populationScore = {
      score: 50,
      weight: 0.3,
      dataSource: "Insufficient data",
      dataAvailable: false,
      detail:
        "Trade area population data not available. Score reflects neutral assumption.",
    };
    flags.push({
      severity: "info",
      dimension: "populationAdequacy",
      message:
        "Trade area population data unavailable — demographic analysis is limited.",
    });
  }

  // ── Income Alignment ───────────────────────────────────────────────

  dataPoints++;
  let incomeScore: DimensionScore;

  if (input.tradeArea?.medianHouseholdIncome != null) {
    dataAvailable++;
    const mhi = input.tradeArea.medianHouseholdIncome;
    const nationalMedian = 75_000;

    const incomeRatio = mhi / nationalMedian;
    let score = 70;
    if (incomeRatio > 1.3) score = 90;
    if (incomeRatio > 1.1) score = 80;
    if (incomeRatio < 0.8) score = 50;
    if (incomeRatio < 0.6) score = 30;

    incomeScore = {
      score,
      weight: 0.2,
      dataSource: "Census median household income",
      dataAvailable: true,
      detail: `Median household income: $${mhi.toLocaleString()}. National median: $${nationalMedian.toLocaleString()}. Ratio: ${incomeRatio.toFixed(2)}x.`,
    };

    if (incomeRatio < 0.7) {
      flags.push({
        severity: "warning",
        dimension: "incomeAlignment",
        message: `Median household income ($${mhi.toLocaleString()}) is significantly below national median. Verify that the business model targets this income bracket.`,
      });
    }
  } else {
    incomeScore = {
      score: 50,
      weight: 0.2,
      dataSource: "Insufficient data",
      dataAvailable: false,
      detail: "Median household income data not available.",
    };
  }

  // ── Competitive Density ────────────────────────────────────────────

  dataPoints++;
  let competitiveScore: DimensionScore;

  if (input.tradeArea?.competitorCount != null) {
    dataAvailable++;
    const competitors = input.tradeArea.competitorCount;
    const pop = input.tradeArea.populationRadius5mi ?? 50_000;
    const competitorsPerCapita = competitors / (pop / 10_000);

    let score = 70;
    if (competitorsPerCapita < 1) score = 95;
    if (competitorsPerCapita < 2) score = 85;
    if (competitorsPerCapita > 5) score = 45;
    if (competitorsPerCapita > 10) score = 20;

    if (
      input.franchise?.existingUnitsInMarket != null &&
      input.franchise.existingUnitsInMarket > 0
    ) {
      if (!input.franchise.territoryExclusive) {
        score = Math.max(score - 15, 10);
        flags.push({
          severity: "warning",
          dimension: "competitiveDensity",
          message: `${input.franchise.existingUnitsInMarket} existing ${input.franchise.brandName ?? "same-brand"} unit(s) in the trade area without exclusive territory protection.`,
        });
      }
    }

    competitiveScore = {
      score,
      weight: 0.3,
      dataSource: "Trade area business count + BIE competitive research",
      dataAvailable: true,
      detail: `${competitors} same-category competitors within 5 miles. ${competitorsPerCapita.toFixed(1)} competitors per 10,000 population.${
        input.franchise?.existingUnitsInMarket
          ? ` ${input.franchise.existingUnitsInMarket} same-brand unit(s) in area.`
          : ""
      }`,
    };
  } else {
    // Fall back to BIE competitive landscape text analysis
    let score = 50;
    let detail = "Competitor count not available.";

    if (input.research.competitiveLandscape) {
      score = 55;
      detail =
        "Competitive landscape assessed from research intelligence (no quantitative competitor count available).";
      dataAvailable++;
    }

    competitiveScore = {
      score,
      weight: 0.3,
      dataSource: input.research.competitiveLandscape
        ? "BIE research (qualitative)"
        : "Insufficient data",
      dataAvailable: !!input.research.competitiveLandscape,
      detail,
    };
  }

  // ── Demand Trend ───────────────────────────────────────────────────

  dataPoints++;
  let trendScore: DimensionScore;

  if (input.tradeArea?.populationGrowthRate5yr != null) {
    dataAvailable++;
    const growthRate = input.tradeArea.populationGrowthRate5yr;
    const annualized = Math.pow(1 + growthRate, 1 / 5) - 1;

    let score = 60;
    if (annualized > 0.02) score = 85;
    if (annualized > 0.01) score = 75;
    if (annualized < 0) score = 40;
    if (annualized < -0.01) score = 25;

    trendScore = {
      score,
      weight: 0.2,
      dataSource: "Census population growth data",
      dataAvailable: true,
      detail: `5-year population growth: ${(growthRate * 100).toFixed(1)}% (${(annualized * 100).toFixed(2)}% annualized). ${
        annualized > 0 ? "Growing" : annualized < 0 ? "Declining" : "Stable"
      } market.`,
    };

    if (annualized < -0.01) {
      flags.push({
        severity: "warning",
        dimension: "demandTrend",
        message: `Population declining at ${(annualized * 100).toFixed(1)}% annually. Shrinking customer base is a structural headwind.`,
      });
    }
  } else {
    trendScore = {
      score: 50,
      weight: 0.2,
      dataSource: "Insufficient data",
      dataAvailable: false,
      detail: "Population trend data not available.",
    };
  }

  // ── Composite ──────────────────────────────────────────────────────

  const dimensions = [
    populationScore,
    incomeScore,
    competitiveScore,
    trendScore,
  ];
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedSum = dimensions.reduce(
    (s, d) => s + d.score * d.weight,
    0,
  );
  const overallScore = Math.round(weightedSum / totalWeight);

  return {
    overallScore,
    populationAdequacy: populationScore,
    incomeAlignment: incomeScore,
    competitiveDensity: competitiveScore,
    demandTrend: trendScore,
    dataCompleteness: dataAvailable / dataPoints,
    flags,
  };
}
