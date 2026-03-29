/**
 * SBA Risk Profile — Phase 58A
 *
 * Weighted composite risk scoring for SBA deals.
 * Components: Industry (40%), Business Age (35%), Loan Term (15%), Location (10%).
 *
 * Pure functions. No DB. No LLM. No side effects.
 * All scores are 0–100 where higher = lower risk (safer).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEIGHTS = {
  industry: 0.40,
  businessAge: 0.35,
  loanTerm: 0.15,
  location: 0.10,
} as const;

// Risk tier thresholds (composite score)
const TIER_THRESHOLDS = {
  LOW: 75,       // >= 75
  MODERATE: 55,  // >= 55
  ELEVATED: 35,  // >= 35
  // < 35 = HIGH
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SBARiskTier = "LOW" | "MODERATE" | "ELEVATED" | "HIGH";

export interface SBARiskProfileInput {
  /** NAICS code for industry lookup */
  naicsCode: string | null;
  /** SBA 5-year default rate for this NAICS (0.0–1.0) */
  sbaDefaultRate5yr: number | null;
  /** SBA 10-year default rate for this NAICS (0.0–1.0) */
  sbaDefaultRate10yr: number | null;
  /** Business age in months */
  businessAgeMonths: number | null;
  /** Loan term in months */
  loanTermMonths: number | null;
  /** Whether business is in an urban area (null = unknown) */
  isUrban: boolean | null;
}

export interface SBARiskProfileResult {
  /** Individual component scores (0–100, higher = safer) */
  industryScore: number;
  businessAgeScore: number;
  loanTermScore: number;
  locationScore: number;
  /** Weighted composite score (0–100) */
  compositeScore: number;
  /** Risk tier derived from composite */
  riskTier: SBARiskTier;
  /** Human-readable explanations for each component */
  explanations: {
    industry: string;
    businessAge: string;
    loanTerm: string;
    location: string;
    overall: string;
  };
}

// ---------------------------------------------------------------------------
// Component Scorers
// ---------------------------------------------------------------------------

/**
 * Industry score based on SBA historical default rates.
 * Lower default rate = higher score.
 *
 * Scoring curve:
 *   0% default → 100
 *   5% default → 75
 *  10% default → 50
 *  20% default → 25
 *  30%+ default → 10
 *  Unknown → 50 (neutral)
 */
export function scoreIndustry(
  defaultRate5yr: number | null,
  defaultRate10yr: number | null,
): { score: number; explanation: string } {
  // Prefer 5yr rate; fallback to 10yr
  const rate = defaultRate5yr ?? defaultRate10yr;

  if (rate === null || rate === undefined) {
    return {
      score: 50,
      explanation: "No SBA default rate data available for this industry. Neutral score applied.",
    };
  }

  // Piecewise linear scoring
  let score: number;
  if (rate <= 0.0) {
    score = 100;
  } else if (rate <= 0.05) {
    score = 100 - (rate / 0.05) * 25; // 100 → 75
  } else if (rate <= 0.10) {
    score = 75 - ((rate - 0.05) / 0.05) * 25; // 75 → 50
  } else if (rate <= 0.20) {
    score = 50 - ((rate - 0.10) / 0.10) * 25; // 50 → 25
  } else if (rate <= 0.30) {
    score = 25 - ((rate - 0.20) / 0.10) * 15; // 25 → 10
  } else {
    score = 10;
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  const pct = (rate * 100).toFixed(1);
  return {
    score,
    explanation:
      score >= 75
        ? `Industry 5yr default rate of ${pct}% is below average. Strong industry profile.`
        : score >= 50
          ? `Industry 5yr default rate of ${pct}% is moderate.`
          : `Industry 5yr default rate of ${pct}% is above average. Elevated industry risk.`,
  };
}

/**
 * Business age score.
 * Older businesses score higher.
 *
 * Scoring curve:
 *   0–6 months → 15
 *   6–12 months → 30
 *   12–24 months → 50
 *   24–60 months → 70
 *   60–120 months → 85
 *   120+ months → 95
 *   Unknown → 40 (conservative)
 */
export function scoreBusinessAge(
  ageMonths: number | null,
): { score: number; explanation: string } {
  if (ageMonths === null) {
    return {
      score: 40,
      explanation: "Business age unknown. Conservative score applied.",
    };
  }

  let score: number;
  if (ageMonths < 6) {
    score = 15;
  } else if (ageMonths < 12) {
    score = 30;
  } else if (ageMonths < 24) {
    score = 50;
  } else if (ageMonths < 60) {
    score = 70;
  } else if (ageMonths < 120) {
    score = 85;
  } else {
    score = 95;
  }

  const years = (ageMonths / 12).toFixed(1);
  return {
    score,
    explanation:
      ageMonths < 24
        ? `Business is ${years} years old (new business). SBA new business protocol applies.`
        : `Business is ${years} years old. Established operating history.`,
  };
}

/**
 * Loan term score.
 * Shorter terms score higher (lower risk).
 *
 * Scoring curve:
 *   0–60 months (5yr) → 90
 *   60–120 months (10yr) → 75
 *   120–240 months (20yr) → 60
 *   240–300 months (25yr) → 45
 *   300+ months → 35
 *   Unknown → 60 (neutral)
 */
export function scoreLoanTerm(
  termMonths: number | null,
): { score: number; explanation: string } {
  if (termMonths === null) {
    return {
      score: 60,
      explanation: "Loan term unknown. Neutral score applied.",
    };
  }

  let score: number;
  if (termMonths <= 60) {
    score = 90;
  } else if (termMonths <= 120) {
    score = 75;
  } else if (termMonths <= 240) {
    score = 60;
  } else if (termMonths <= 300) {
    score = 45;
  } else {
    score = 35;
  }

  const years = Math.round(termMonths / 12);
  return {
    score,
    explanation: `${years}-year loan term. ${
      score >= 75 ? "Shorter duration reduces exposure." : "Longer duration increases exposure period."
    }`,
  };
}

/**
 * Location score.
 * Urban areas score slightly higher (larger market, more diversification).
 *
 * Urban → 65, Rural → 50, Unknown → 55
 */
export function scoreLocation(
  isUrban: boolean | null,
): { score: number; explanation: string } {
  if (isUrban === null) {
    return {
      score: 55,
      explanation: "Location type unknown. Neutral score applied.",
    };
  }

  return isUrban
    ? { score: 65, explanation: "Urban location. Larger addressable market." }
    : { score: 50, explanation: "Rural location. SBA community advantage may apply." };
}

// ---------------------------------------------------------------------------
// Composite Scorer
// ---------------------------------------------------------------------------

/**
 * Derive risk tier from composite score.
 */
export function deriveRiskTier(compositeScore: number): SBARiskTier {
  if (compositeScore >= TIER_THRESHOLDS.LOW) return "LOW";
  if (compositeScore >= TIER_THRESHOLDS.MODERATE) return "MODERATE";
  if (compositeScore >= TIER_THRESHOLDS.ELEVATED) return "ELEVATED";
  return "HIGH";
}

/**
 * Compute the full SBA risk profile.
 * Pure function — deterministic, no side effects.
 */
export function computeSBARiskProfile(
  input: SBARiskProfileInput,
): SBARiskProfileResult {
  const industry = scoreIndustry(input.sbaDefaultRate5yr, input.sbaDefaultRate10yr);
  const businessAge = scoreBusinessAge(input.businessAgeMonths);
  const loanTerm = scoreLoanTerm(input.loanTermMonths);
  const location = scoreLocation(input.isUrban);

  const compositeScore = Math.round(
    industry.score * WEIGHTS.industry +
    businessAge.score * WEIGHTS.businessAge +
    loanTerm.score * WEIGHTS.loanTerm +
    location.score * WEIGHTS.location,
  );

  const riskTier = deriveRiskTier(compositeScore);

  const tierLabel: Record<SBARiskTier, string> = {
    LOW: "Low risk profile. Standard SBA underwriting applies.",
    MODERATE: "Moderate risk profile. Standard SBA underwriting with attention to flagged areas.",
    ELEVATED: "Elevated risk profile. Enhanced due diligence recommended.",
    HIGH: "High risk profile. Significant risk factors present. Thorough review required.",
  };

  return {
    industryScore: industry.score,
    businessAgeScore: businessAge.score,
    loanTermScore: loanTerm.score,
    locationScore: location.score,
    compositeScore,
    riskTier,
    explanations: {
      industry: industry.explanation,
      businessAge: businessAge.explanation,
      loanTerm: loanTerm.explanation,
      location: location.explanation,
      overall: tierLabel[riskTier],
    },
  };
}
