export type ValidationFactMap = Record<string, number | null>;

export const VALIDATION_RULESET_VERSION = "buddy-validation-v2";

const CANONICAL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ANNUAL_DEBT_SERVICE: ["CF_ANNUAL_DEBT_SERVICE", "ADS"],
  CASH_FLOW_AVAILABLE: ["CF_NCADS"],
  DSCR: ["RATIO_DSCR_FINAL"],
  NET_WORTH: ["TOTAL_EQUITY", "SL_TOTAL_EQUITY"],
  TOTAL_ASSETS: ["SL_TOTAL_ASSETS"],
  TOTAL_LIABILITIES: ["SL_TOTAL_LIABILITIES"],
};

/**
 * Projects the production fact vocabulary into the stable logical names used
 * by the deterministic validation rules. Source facts remain untouched and a
 * canonical value always wins over an alias.
 */
export function normalizeValidationFacts(input: ValidationFactMap): ValidationFactMap {
  const normalized = { ...input };

  for (const [canonicalKey, aliases] of Object.entries(CANONICAL_ALIASES)) {
    if (normalized[canonicalKey] !== null && normalized[canonicalKey] !== undefined) continue;
    const alias = aliases.find((key) => normalized[key] !== null && normalized[key] !== undefined);
    if (alias) normalized[canonicalKey] = normalized[alias];
  }

  return normalized;
}
