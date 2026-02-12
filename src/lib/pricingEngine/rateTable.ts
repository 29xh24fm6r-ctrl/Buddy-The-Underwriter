/**
 * Pricing Engine — Rate Table
 *
 * Mock index constants and per-product base rate definitions.
 * No live rate fetching — all rates are deterministic constants.
 *
 * PHASE 5C: Pure constants — no DB, no external calls.
 */

import type { ProductType } from "@/lib/creditLenses/types";
import type { BaseRateEntry, RateIndex } from "./types";

// ---------------------------------------------------------------------------
// Index Constants (mock — no live rate fetching)
// ---------------------------------------------------------------------------

export const INDEX_RATES: Record<RateIndex, number> = {
  PRIME: 0.085,   // 8.50%
  SOFR: 0.0433,   // 4.33%
};

// ---------------------------------------------------------------------------
// Per-Product Rate Table
// ---------------------------------------------------------------------------

function entry(
  product: ProductType,
  index: RateIndex,
  spreadBps: number,
): BaseRateEntry {
  const indexRate = INDEX_RATES[index];
  return {
    product,
    index,
    indexRate,
    spreadBps,
    baseRate: indexRate + spreadBps / 10_000,
  };
}

const RATE_TABLE: Record<ProductType, BaseRateEntry> = {
  SBA: entry("SBA", "PRIME", 275),           // 8.50% + 2.75% = 11.25%
  LOC: entry("LOC", "PRIME", 150),           // 8.50% + 1.50% = 10.00%
  EQUIPMENT: entry("EQUIPMENT", "PRIME", 200), // 8.50% + 2.00% = 10.50%
  ACQUISITION: entry("ACQUISITION", "PRIME", 300), // 8.50% + 3.00% = 11.50%
  CRE: entry("CRE", "SOFR", 225),           // 4.33% + 2.25% = 6.58%
};

/**
 * Get the base rate entry for a product type.
 */
export function getBaseRate(product: ProductType): BaseRateEntry {
  return RATE_TABLE[product];
}
