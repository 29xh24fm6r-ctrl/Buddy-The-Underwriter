/**
 * Canonical Fact Alias Mapping
 *
 * Centralizes the mapping between legacy/colloquial fact key names and their
 * canonical fact_type + fact_key pairs in the deal_financial_facts table.
 *
 * IMPORTANT: Do NOT scatter alias logic across memo, readiness, and synthesis.
 * All key translation goes through this file.
 */

import { CANONICAL_FACTS } from "@/lib/financialFacts/keys";

// ── Alias → Canonical key mapping ─────────────────────────────────────

/**
 * Maps common aliases to their canonical CANONICAL_FACTS key.
 * Consumers can use either the alias or the canonical key; this map
 * resolves aliases to canonical form.
 */
export const FACT_KEY_ALIASES: Record<string, keyof typeof CANONICAL_FACTS> = {
  // Collateral aliases
  GROSS_VALUE: "COLLATERAL_GROSS_VALUE",
  NET_VALUE: "COLLATERAL_NET_VALUE",
  DISCOUNTED_VALUE: "COLLATERAL_DISCOUNTED_VALUE",
  DISCOUNTED_COVERAGE: "COLLATERAL_DISCOUNTED_COVERAGE",
  AS_IS_VALUE: "COLLATERAL_GROSS_VALUE", // AS_IS treated as gross

  // Loan amount aliases
  REQUESTED_LOAN_AMOUNT: "BANK_LOAN_TOTAL",
  LOAN_AMOUNT: "BANK_LOAN_TOTAL",

  // Identity mappings (canonical key → itself, for uniform lookup)
  COLLATERAL_GROSS_VALUE: "COLLATERAL_GROSS_VALUE",
  COLLATERAL_NET_VALUE: "COLLATERAL_NET_VALUE",
  COLLATERAL_DISCOUNTED_VALUE: "COLLATERAL_DISCOUNTED_VALUE",
  COLLATERAL_DISCOUNTED_COVERAGE: "COLLATERAL_DISCOUNTED_COVERAGE",
  LTV_GROSS: "LTV_GROSS",
  LTV_NET: "LTV_NET",
  BANK_LOAN_TOTAL: "BANK_LOAN_TOTAL",
  TOTAL_PROJECT_COST: "TOTAL_PROJECT_COST",
  BORROWER_EQUITY: "BORROWER_EQUITY",
  BORROWER_EQUITY_PCT: "BORROWER_EQUITY_PCT",
};

/**
 * Resolve a potentially aliased fact key to its canonical
 * { fact_type, fact_key } pair.
 *
 * Returns null if the alias is unknown and the key is not in CANONICAL_FACTS.
 */
export function resolveFactAlias(
  key: string,
): { fact_type: string; fact_key: string } | null {
  const canonical = FACT_KEY_ALIASES[key];
  if (canonical && CANONICAL_FACTS[canonical]) {
    const entry = CANONICAL_FACTS[canonical];
    return { fact_type: entry.fact_type, fact_key: entry.fact_key };
  }

  // Try direct lookup
  const direct = CANONICAL_FACTS[key as keyof typeof CANONICAL_FACTS];
  if (direct) {
    return { fact_type: direct.fact_type, fact_key: direct.fact_key };
  }

  return null;
}
