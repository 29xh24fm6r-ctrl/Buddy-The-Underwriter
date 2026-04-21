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

  const dataCompletenessAvg =
    (params.marketDemand.dataCompleteness +
      params.financialViability.dataCompleteness +
      params.operationalReadiness.dataCompleteness +
      params.locationSuitability.dataCompleteness) /
    4;

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

  const dimensionsMissingData: string[] = [];
  if (params.marketDemand.dataCompleteness < 0.5)
    dimensionsMissingData.push("Market Demand");
  if (params.financialViability.dataCompleteness < 0.5)
    dimensionsMissingData.push("Financial Viability");
  if (params.operationalReadiness.dataCompleteness < 0.5)
    dimensionsMissingData.push("Operational Readiness");
  if (params.locationSuitability.dataCompleteness < 0.5)
    dimensionsMissingData.push("Location Suitability");

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
  };
}
