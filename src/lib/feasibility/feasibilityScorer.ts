// src/lib/feasibility/feasibilityScorer.ts
// Phase God Tier Feasibility — Composite Scorer (step 7/16).
// Pure function. No DB, no LLM, no side effects. Combines the 4
// dimension scores into a composite 0-100 score + recommendation +
// confidence level. This is the heart of the system.

import type {
  CompositeFeasibilityScore,
  FeasibilityRecommendation,
  FinancialViabilityScore,
  LocationSuitabilityScore,
  MarketDemandScore,
  MarketFlag,
  OperationalReadinessScore,
} from "./types";

// ── Weights ─────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
  marketDemand: 0.3,
  financialViability: 0.35,
  operationalReadiness: 0.15,
  locationSuitability: 0.2,
};

// Franchise deals: financial viability a bit less (franchise system support
// reduces execution risk); operational readiness a bit more (franchise
// execution discipline is critical).
const FRANCHISE_WEIGHTS = {
  marketDemand: 0.25,
  financialViability: 0.3,
  operationalReadiness: 0.25,
  locationSuitability: 0.2,
};

// ── Scorer ──────────────────────────────────────────────────────────────

export function computeCompositeFeasibility(params: {
  marketDemand: MarketDemandScore;
  financialViability: FinancialViabilityScore;
  operationalReadiness: OperationalReadinessScore;
  locationSuitability: LocationSuitabilityScore;
  isFranchise: boolean;
  /**
   * Optional: Phase 3 franchise weapon — when FDD data is available, confidence
   * level gets a bump since the inputs are more reliable than NAICS benchmarks.
   */
  franchiseDataAvailable?: boolean;
}): CompositeFeasibilityScore {
  const weights = params.isFranchise ? FRANCHISE_WEIGHTS : DEFAULT_WEIGHTS;

  const weightedSum =
    params.marketDemand.overallScore * weights.marketDemand +
    params.financialViability.overallScore * weights.financialViability +
    params.operationalReadiness.overallScore * weights.operationalReadiness +
    params.locationSuitability.overallScore * weights.locationSuitability;

  const overallScore = Math.round(weightedSum);

  // ── Aggregate flags ──────────────────────────────────────────────

  const allFlags: MarketFlag[] = [
    ...params.marketDemand.flags,
    ...params.financialViability.flags,
    ...params.operationalReadiness.flags,
    ...params.locationSuitability.flags,
  ];

  const criticalFlags = allFlags.filter(
    (f) => f.severity === "critical",
  ).length;
  const warningFlags = allFlags.filter((f) => f.severity === "warning").length;
  const infoFlags = allFlags.filter((f) => f.severity === "info").length;

  // ── Recommendation ───────────────────────────────────────────────
  // Critical flags can override a good raw score.

  let recommendation: FeasibilityRecommendation;
  if (criticalFlags >= 3) {
    recommendation = "Not Recommended";
  } else if (criticalFlags >= 2 && overallScore < 65) {
    recommendation = "Not Recommended";
  } else if (overallScore >= 80 && criticalFlags === 0) {
    recommendation = "Strongly Recommended";
  } else if (overallScore >= 65) {
    recommendation = criticalFlags > 0 ? "Conditionally Feasible" : "Recommended";
  } else if (overallScore >= 50) {
    recommendation = "Conditionally Feasible";
  } else if (overallScore >= 35) {
    recommendation = "Significant Concerns";
  } else {
    recommendation = "Not Recommended";
  }

  // ── Confidence ───────────────────────────────────────────────────

  // Weight the dimensions the same way the score does. A plain /4 average
  // let a 0.15-weight dimension move the release gate as much as a
  // 0.35-weight one, so "data completeness" did not describe the share of
  // the decision that was evidence-backed — which is how the PDF presents it
  // and how the release gate reads it.
  const completenessByDimension: Array<[keyof typeof weights, number, string]> = [
    ["marketDemand", params.marketDemand.dataCompleteness, "Market Demand"],
    ["financialViability", params.financialViability.dataCompleteness, "Financial Viability"],
    ["operationalReadiness", params.operationalReadiness.dataCompleteness, "Operational Readiness"],
    ["locationSuitability", params.locationSuitability.dataCompleteness, "Location Suitability"],
  ];
  const dataCompletenessAvg = completenessByDimension.reduce(
    (sum, [key, value]) => sum + value * weights[key],
    0,
  );

  // Name the gaps, not just their size. `feasibility_data_completeness_below_
  // 70_percent` told an operator nothing about which evidence to go get.
  const missingEvidence = [
    ...params.marketDemand.coverage.missing.map((k) => `market_demand.${k}`),
    ...params.financialViability.coverage.missing.map((k) => `financial_viability.${k}`),
    ...params.operationalReadiness.coverage.missing.map((k) => `operational_readiness.${k}`),
    ...params.locationSuitability.coverage.missing.map((k) => `location_suitability.${k}`),
  ];
  const notApplicableEvidence = [
    ...params.marketDemand.coverage.notApplicable.map((n) => `market_demand.${n.key}`),
    ...params.financialViability.coverage.notApplicable.map((n) => `financial_viability.${n.key}`),
    ...params.operationalReadiness.coverage.notApplicable.map((n) => `operational_readiness.${n.key}`),
    ...params.locationSuitability.coverage.notApplicable.map((n) => `location_suitability.${n.key}`),
  ];

  let confidenceLevel: "High" | "Moderate" | "Low";
  if (dataCompletenessAvg >= 0.75) confidenceLevel = "High";
  else if (dataCompletenessAvg >= 0.5) confidenceLevel = "Moderate";
  else confidenceLevel = "Low";

  // Franchise data bonus — FDD data is audited and brand-specific, so when
  // it is available the confidence tier bumps up one notch.
  if (params.isFranchise && params.franchiseDataAvailable) {
    if (confidenceLevel === "Moderate") confidenceLevel = "High";
    else if (confidenceLevel === "Low") confidenceLevel = "Moderate";
  }

  const dimensionsMissingData = completenessByDimension
    .filter(([, value]) => value < 0.5)
    .map(([, , label]) => label);

  return {
    overallScore,
    recommendation,
    confidenceLevel,
    marketDemand: {
      score: params.marketDemand.overallScore,
      weight: weights.marketDemand,
    },
    financialViability: {
      score: params.financialViability.overallScore,
      weight: weights.financialViability,
    },
    operationalReadiness: {
      score: params.operationalReadiness.overallScore,
      weight: weights.operationalReadiness,
    },
    locationSuitability: {
      score: params.locationSuitability.overallScore,
      weight: weights.locationSuitability,
    },
    criticalFlags,
    warningFlags,
    infoFlags,
    allFlags,
    overallDataCompleteness: dataCompletenessAvg,
    dimensionsMissingData,
    missingEvidence,
    notApplicableEvidence,
  };
}
