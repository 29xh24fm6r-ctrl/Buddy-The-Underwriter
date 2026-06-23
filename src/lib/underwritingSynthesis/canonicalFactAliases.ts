/**
 * Canonical Fact Alias Mapping
 *
 * Centralizes the mapping between legacy/colloquial fact key names and their
 * canonical fact_type + fact_key pairs in the deal_financial_facts table.
 *
 * IMPORTANT: Do NOT scatter alias logic across memo, readiness, and synthesis.
 * All key translation goes through this file.
 *
 * Both legacy keys (GROSS_VALUE, BORROWER_EQUITY) and canonical-named keys
 * (COLLATERAL_GROSS_VALUE, EQUITY_INJECTION) exist as DB rows after synthesis.
 * This map resolves any variant to its canonical CANONICAL_FACTS entry.
 */

import { CANONICAL_FACTS } from "@/lib/financialFacts/keys";

// ── Alias → Canonical key mapping ─────────────────────────────────────

export const FACT_KEY_ALIASES: Record<string, keyof typeof CANONICAL_FACTS> = {
  // Collateral aliases (legacy → canonical)
  GROSS_VALUE: "COLLATERAL_GROSS_VALUE",
  NET_VALUE: "COLLATERAL_NET_VALUE",
  DISCOUNTED_VALUE: "COLLATERAL_DISCOUNTED_VALUE",
  DISCOUNTED_COVERAGE: "COLLATERAL_DISCOUNTED_COVERAGE",
  AS_IS_VALUE: "COLLATERAL_GROSS_VALUE",
  COLLATERAL_COVERAGE_RATIO: "COLLATERAL_COVERAGE_RATIO",

  // Equity aliases
  BORROWER_EQUITY: "BORROWER_EQUITY",
  BORROWER_EQUITY_PCT: "BORROWER_EQUITY_PCT",
  EQUITY_INJECTION: "EQUITY_INJECTION",
  EQUITY_INJECTION_PCT: "EQUITY_INJECTION_PCT",

  // Loan amount aliases
  REQUESTED_LOAN_AMOUNT: "BANK_LOAN_TOTAL",
  LOAN_AMOUNT: "BANK_LOAN_TOTAL",

  // Identity mappings (canonical key → itself)
  COLLATERAL_GROSS_VALUE: "COLLATERAL_GROSS_VALUE",
  COLLATERAL_NET_VALUE: "COLLATERAL_NET_VALUE",
  COLLATERAL_DISCOUNTED_VALUE: "COLLATERAL_DISCOUNTED_VALUE",
  COLLATERAL_DISCOUNTED_COVERAGE: "COLLATERAL_DISCOUNTED_COVERAGE",
  LTV_GROSS: "LTV_GROSS",
  LTV_NET: "LTV_NET",
  BANK_LOAN_TOTAL: "BANK_LOAN_TOTAL",
  TOTAL_PROJECT_COST: "TOTAL_PROJECT_COST",
};

/**
 * Given a fact key that may be an alias, returns the list of DB fact_keys
 * to search — canonical first, then legacy aliases.
 *
 * Use this in memo builders to implement canonical-first lookup:
 *   for (const fk of factKeySearchOrder("COLLATERAL_GROSS_VALUE")) {
 *     const val = getFactValue("COLLATERAL", fk);
 *     if (val !== null) return val;
 *   }
 */
export function factKeySearchOrder(canonicalKey: string): string[] {
  const keys: string[] = [canonicalKey];

  // Add legacy alias if different from canonical
  const CANONICAL_TO_LEGACY: Record<string, string> = {
    COLLATERAL_GROSS_VALUE: "GROSS_VALUE",
    COLLATERAL_NET_VALUE: "NET_VALUE",
    COLLATERAL_DISCOUNTED_VALUE: "DISCOUNTED_VALUE",
    COLLATERAL_COVERAGE_RATIO: "DISCOUNTED_COVERAGE",
    EQUITY_INJECTION: "BORROWER_EQUITY",
    EQUITY_INJECTION_PCT: "BORROWER_EQUITY_PCT",
  };

  const legacy = CANONICAL_TO_LEGACY[canonicalKey];
  if (legacy && legacy !== canonicalKey) {
    keys.push(legacy);
  }

  return keys;
}

/**
 * Resolve a potentially aliased fact key to its canonical
 * { fact_type, fact_key } pair.
 */
export function resolveFactAlias(
  key: string,
): { fact_type: string; fact_key: string } | null {
  const canonical = FACT_KEY_ALIASES[key];
  if (canonical && CANONICAL_FACTS[canonical]) {
    const entry = CANONICAL_FACTS[canonical];
    return { fact_type: entry.fact_type, fact_key: entry.fact_key };
  }

  const direct = CANONICAL_FACTS[key as keyof typeof CANONICAL_FACTS];
  if (direct) {
    return { fact_type: direct.fact_type, fact_key: direct.fact_key };
  }

  return null;
}
