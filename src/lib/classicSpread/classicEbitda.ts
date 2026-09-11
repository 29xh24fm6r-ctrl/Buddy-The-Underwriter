/** Classic spread adapter for the shared conservative EBITDA calculation. Pure, no I/O. */

import { computeEbitda } from "@/lib/financialIntelligence/ebitdaEngine";

/** Fact keys the canonical base resolver reads (C-corp tax reconstruction). */
const EBITDA_BASE_KEYS = [
  "ORDINARY_BUSINESS_INCOME",
  "TAXABLE_INCOME",
  "M1_TAXABLE_INCOME",
  "NET_INCOME",
  "TOTAL_TAX",
  "M1_FEDERAL_TAX_BOOK",
  "INTEREST_EXPENSE",
  "DEPRECIATION",
  "AMORTIZATION",
] as const;

/**
 * Traditional EBITDA (pre-tax base + interest + depreciation + amortization), consistent with the
 * canonical EBITDA base resolver's C-corp income-tax treatment.
 *
 * @param get - resolves a fact value by canonical fact key for the period/entity (null when absent).
 * @returns EBITDA, or null when the base income is unavailable.
 */
export function classicTraditionalEbitda(get: (key: string) => number | null): number | null {
  const facts: Record<string, number | null> = {};
  for (const k of EBITDA_BASE_KEYS) facts[k] = get(k);

  return computeEbitda(facts, "UNKNOWN", { ebitda_addback_stack: "conservative" }).adjustedEbitda;
}
