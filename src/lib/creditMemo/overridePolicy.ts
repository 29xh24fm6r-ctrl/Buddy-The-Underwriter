// Pure. No DB. No side effects. No network.
// Single shared override policy for all memo override write paths.
// deal_memo_overrides is qualitative narrative ONLY — never numeric/computed.

/**
 * Permitted override keys — qualitative banker narrative only.
 * These are the ONLY keys that may be written to deal_memo_overrides.
 */
export const PERMITTED_OVERRIDE_KEYS = new Set([
  // Business context
  "business_description",
  "company_history",
  "products_services",
  "competitive_position",
  "market_position",
  "industry_overview",

  // Use of proceeds / purpose
  "use_of_proceeds",
  "loan_purpose_narrative",
  "transaction_description",

  // Repayment / source
  "repayment_source",
  "repayment_narrative",

  // Management / principals
  "management_assessment",
  "management_experience",
  "ownership_structure",

  // Collateral narrative
  "collateral_description",
  "collateral_narrative",
  "collateral_address",
  "property_description",

  // Risk / mitigants
  "risk_mitigants",
  "strengths",
  "weaknesses",
  "risk_factors",

  // Committee / recommendation
  "committee_notes",
  "recommendation_narrative",
  "conditions_narrative",
  "covenant_narrative",

  // Business detail (qualitative)
  "revenue_mix",
  "seasonality",

  // Builder story mappings
  "principal_background",
  "key_weaknesses",
  "key_strengths",

  // Business strategy
  "competitive_advantages",
  "vision",

  // Other free-text
  "additional_notes",
  "guarantor_notes",
  "structure_notes",

  // Phase 91 Part B — Banker Review Layer
  // Qualitative-score override blobs (per-dimension { score, reason }).
  // These are banker judgement, not computed metrics, so they belong here.
  "qualitative_override_character",
  "qualitative_override_capital",
  "qualitative_override_conditions",
  "qualitative_override_management",
  "qualitative_override_business_model",
  "character_concerns",
  // Covenant package banker review
  "covenant_banker_notes",
  "covenant_adjustments",
  // Pre-submission checklist state
  "committee_ready",
  "committee_reviewed_at",
  "tabs_viewed",
]);

/**
 * Pattern for principal bio keys — always permitted.
 * Matches: principal_bio_*, principal_name_*, guarantor_bio_*
 */
const PRINCIPAL_BIO_PATTERN = /^(principal_bio_|principal_name_|guarantor_bio_)/;

/**
 * Numeric/computed key patterns — always forbidden.
 * Any key matching these patterns is rejected.
 */
const FORBIDDEN_PATTERNS = [
  /dscr/i,
  /leverage/i,
  /ltv/i,
  /ltc/i,
  /revenue/i,
  /ebitda/i,
  /noi/i,
  /net_income/i,
  /loan_amount/i,
  /collateral_value/i,
  /appraised_value/i,
  /liquidity/i,
  /ratio/i,
  /margin/i,
  /growth_rate/i,
  /yield/i,
  /debt_service/i,
  /occupancy_rate/i,
  /cap_rate/i,
  /vacancy/i,
];

/**
 * Check if a key is a permitted qualitative override.
 */
export function isPermittedOverrideKey(key: string): boolean {
  // Principal bio pattern always allowed
  if (PRINCIPAL_BIO_PATTERN.test(key)) return true;

  // Explicit permitted keys
  if (PERMITTED_OVERRIDE_KEYS.has(key)) return true;

  // Check forbidden patterns
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(key)) return false;
  }

  // Unknown keys — reject by default (fail-safe)
  return false;
}

/**
 * Filter an overrides object to only permitted qualitative keys.
 * Returns both accepted and rejected keys for audit logging.
 */
export function filterQualitativeOverrides(
  overrides: Record<string, unknown>,
): {
  accepted: Record<string, unknown>;
  rejected: string[];
} {
  const accepted: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(overrides)) {
    if (isPermittedOverrideKey(key)) {
      accepted[key] = value;
    } else {
      rejected.push(key);
    }
  }

  return { accepted, rejected };
}
