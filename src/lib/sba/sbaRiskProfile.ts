/**
 * SBA Risk Profile — Phase 58A
 *
 * Four-factor weighted composite risk scoring for SBA deals.
 * Industry default rate (40%), Business age (35%), Loan term (15%), Urban/rural (10%).
 *
 * OCC SR 11-7 requires explainability — all logic is deterministic.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assessNewBusinessRisk,
  detectNewBusinessFromFacts,
} from "./newBusinessProtocol";
import { getSBAIndustryDefaultProfile } from "@/lib/benchmarks/industryBenchmarks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoanTermRiskTier = "short" | "medium" | "long" | "very_long";
export type UrbanRuralClassification =
  | "urban"
  | "rural"
  | "suburban"
  | "unknown";

export interface SBARiskProfileFactor {
  factorName: string;
  label: string;
  tier: "low" | "medium" | "high" | "very_high" | "unknown";
  riskScore: number; // 1–5
  narrative: string;
  source: string;
}

export interface SBARiskProfile {
  dealId: string;
  computedAt: string;
  loanType: string;
  industryFactor: SBARiskProfileFactor;
  businessAgeFactor: SBARiskProfileFactor;
  loanTermFactor: SBARiskProfileFactor;
  urbanRuralFactor: SBARiskProfileFactor;
  compositeRiskScore: number;
  compositeRiskTier: "low" | "medium" | "high" | "very_high";
  compositeNarrative: string;
  newBusinessResult: import("./newBusinessProtocol").NewBusinessUnderwritingResult;
  requiresProjectedDscr: boolean;
  projectedDscrThreshold: number;
  equityInjectionFloor: number;
  hardBlockers: string[];
  softWarnings: string[];
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

const FACTOR_WEIGHTS = {
  industry: 0.4,
  businessAge: 0.35,
  loanTerm: 0.15,
  urbanRural: 0.1,
} as const;

function tierToScore(
  tier: "low" | "medium" | "high" | "very_high" | "unknown",
): number {
  return { low: 1, medium: 2, high: 3.5, very_high: 5, unknown: 2.5 }[tier];
}

function termTierToScore(tier: LoanTermRiskTier): number {
  return { short: 1, medium: 2, long: 3, very_long: 4 }[tier];
}

function scoreToTier(
  s: number,
): SBARiskProfile["compositeRiskTier"] {
  if (s < 2.0) return "low";
  if (s < 3.0) return "medium";
  if (s < 4.0) return "high";
  return "very_high";
}

function assessLoanTermRisk(
  termMonths: number | null,
): { tier: LoanTermRiskTier; note: string } {
  if (termMonths === null)
    return { tier: "medium", note: "Loan term not specified" };
  if (termMonths <= 36)
    return {
      tier: "short",
      note: "Short-term loan (\u2264 3 years) \u2014 lower default exposure",
    };
  if (termMonths <= 84)
    return {
      tier: "medium",
      note: "Medium-term loan (3\u20137 years) \u2014 typical SBA 7(a) structure",
    };
  if (termMonths <= 180)
    return {
      tier: "long",
      note: "Long-term loan (7\u201315 years) \u2014 extended default exposure",
    };
  return {
    tier: "very_long",
    note: "Very long-term loan (> 15 years) \u2014 maximum SBA term",
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export async function buildSBARiskProfile(params: {
  dealId: string;
  loanType: string;
  naicsCode: string | null;
  termMonths: number | null;
  urbanRural: UrbanRuralClassification | null;
  state: string | null;
  zip: string | null;
  facts: Array<{
    fact_key: string;
    value_numeric: number | null;
    value_text: string | null;
  }>;
  managementYearsInIndustry: number | null;
  hasBusinessPlan: boolean;
  sb: SupabaseClient;
}): Promise<SBARiskProfile> {
  const {
    dealId,
    loanType,
    naicsCode,
    termMonths,
    facts,
    managementYearsInIndustry,
    hasBusinessPlan,
    urbanRural,
    sb,
  } = params;

  // Factor 1: Industry
  const industryProfile = naicsCode
    ? await getSBAIndustryDefaultProfile(naicsCode, sb)
    : null;
  const industryTier = (industryProfile?.defaultRiskTier ??
    "unknown") as SBARiskProfileFactor["tier"];
  const industryScore = tierToScore(industryTier);
  const industryFactor: SBARiskProfileFactor = {
    factorName: "industry_default_rate",
    label: industryProfile?.benchmarkAvailable
      ? `Industry Default Risk: ${industryTier.toUpperCase().replace("_", " ")} (${industryProfile.defaultRateFormatted})`
      : "Industry Default Risk: No benchmark available",
    tier: industryTier,
    riskScore: industryScore,
    narrative: industryProfile?.benchmarkAvailable
      ? `Businesses in NAICS ${naicsCode} (${industryProfile.naicsDescription ?? "this industry"}) have a historical SBA default rate of ${industryProfile.defaultRateFormatted} based on ${industryProfile.sampleSize?.toLocaleString() ?? "historical"} loans from ${industryProfile.dataPeriod ?? "1987\u20132014"}. This is a population-level historical baseline \u2014 individual loan outcomes depend on borrower-specific factors.`
      : `No SBA default benchmark available for NAICS ${naicsCode ?? "not specified"}.`,
    source:
      "U.S. SBA national loan database (1987\u20132014), ~899,164 observations",
  };

  // Factor 2: Business age
  const { yearsInBusiness, monthsInBusiness } =
    detectNewBusinessFromFacts(facts);
  const newBusinessResult = assessNewBusinessRisk({
    yearsInBusiness,
    monthsInBusiness,
    hasBusinessPlan,
    managementYearsInIndustry,
    loanType,
  });
  const ageTier: SBARiskProfileFactor["tier"] =
    newBusinessResult.riskFactorLabel === "STARTUP"
      ? "very_high"
      : newBusinessResult.riskFactorLabel === "EARLY_STAGE"
        ? "high"
        : "low";
  const businessAgeFactor: SBARiskProfileFactor = {
    factorName: "business_age",
    label: `Business Age: ${newBusinessResult.riskFactorLabel.replace("_", " ")} (${
      monthsInBusiness !== null
        ? `${Math.round(monthsInBusiness)} months`
        : "unknown"
    })`,
    tier: ageTier,
    riskScore: tierToScore(ageTier),
    narrative: newBusinessResult.flags.narrativeContext,
    source: "SBA SOP 50 10 8 and historical default pattern analysis",
  };

  // Factor 3: Loan term
  const termAssessment = assessLoanTermRisk(termMonths);
  const termScore = termTierToScore(termAssessment.tier);
  const termTier: SBARiskProfileFactor["tier"] =
    termAssessment.tier === "very_long"
      ? "high"
      : termAssessment.tier === "long"
        ? "medium"
        : "low";
  const loanTermFactor: SBARiskProfileFactor = {
    factorName: "loan_term",
    label: `Loan Term Risk: ${termAssessment.tier.toUpperCase().replace("_", " ")} (${
      termMonths
        ? `${Math.round(termMonths / 12)} years`
        : "not specified"
    })`,
    tier: termTier,
    riskScore: termScore,
    narrative:
      termAssessment.note +
      ". Longer terms increase default exposure due to the extended window for business conditions to change.",
    source:
      "Historical SBA default analysis \u2014 loan term is a top predictor of default",
  };

  // Factor 4: Urban/rural
  const classification = urbanRural ?? "unknown";
  const urbanRuralTier: SBARiskProfileFactor["tier"] =
    classification === "rural" ? "medium" : "low";
  const urbanRuralFactor: SBARiskProfileFactor = {
    factorName: "urban_rural",
    label: `Location: ${classification.toUpperCase()}`,
    tier: urbanRuralTier,
    riskScore: tierToScore(urbanRuralTier),
    narrative:
      classification === "rural"
        ? "Rural business location \u2014 SBA historical data shows modestly higher default rates in rural markets due to concentrated economic dependency and limited refinancing alternatives."
        : "Urban/suburban business location \u2014 typical SBA risk profile for this factor.",
    source:
      "SBA historical data \u2014 urban/rural is the weakest of the four empirical predictors",
  };

  // Composite
  const compositeScore =
    industryScore * FACTOR_WEIGHTS.industry +
    tierToScore(ageTier) * FACTOR_WEIGHTS.businessAge +
    termScore * FACTOR_WEIGHTS.loanTerm +
    tierToScore(urbanRuralTier) * FACTOR_WEIGHTS.urbanRural;
  const compositeRiskTier = scoreToTier(compositeScore);

  const compositeNarrative = [
    `SBA risk profile composite score: ${compositeScore.toFixed(1)}/5.0 (${compositeRiskTier.replace("_", " ")} risk).`,
    industryProfile?.benchmarkAvailable
      ? `Primary risk driver: ${industryFactor.label}.`
      : null,
    newBusinessResult.flags.isNewBusiness
      ? `Business age is a significant risk factor \u2014 projected DSCR analysis required (${newBusinessResult.flags.projectedDscrThreshold}x minimum).`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const hardBlockers = [...newBusinessResult.flags.blockers];
  const softWarnings = [...newBusinessResult.flags.warnings];

  if (industryTier === "very_high" && newBusinessResult.flags.isNewBusiness) {
    hardBlockers.push(
      "Very high industry default rate combined with new business status \u2014 consider requiring 6-month interest reserve or additional collateral",
    );
  }

  // Persist to cache table
  await sb.from("buddy_sba_risk_profiles").upsert(
    {
      deal_id: dealId,
      loan_type: loanType,
      naics_code: naicsCode,
      industry_factor: industryFactor,
      business_age_factor: businessAgeFactor,
      loan_term_factor: loanTermFactor,
      urban_rural_factor: urbanRuralFactor,
      composite_risk_score: compositeScore,
      composite_risk_tier: compositeRiskTier,
      composite_narrative: compositeNarrative,
      requires_projected_dscr: newBusinessResult.flags.requiresProjectedDscr,
      projected_dscr_threshold:
        newBusinessResult.flags.projectedDscrThreshold,
      equity_injection_floor: newBusinessResult.flags.equityInjectionFloor,
      hard_blockers: hardBlockers,
      soft_warnings: softWarnings,
    },
    { onConflict: "deal_id" },
  );

  return {
    dealId,
    computedAt: new Date().toISOString(),
    loanType,
    industryFactor,
    businessAgeFactor,
    loanTermFactor,
    urbanRuralFactor,
    compositeRiskScore: compositeScore,
    compositeRiskTier,
    compositeNarrative,
    newBusinessResult,
    requiresProjectedDscr: newBusinessResult.flags.requiresProjectedDscr,
    projectedDscrThreshold: newBusinessResult.flags.projectedDscrThreshold,
    equityInjectionFloor: newBusinessResult.flags.equityInjectionFloor,
    hardBlockers,
    softWarnings,
  };
}
