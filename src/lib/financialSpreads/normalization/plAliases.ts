/**
 * Bank-grade P&L alias map.
 *
 * Purpose: normalize many label variants across industries into canonical concepts.
 * Used by the generic row scanner as a fallback when fixed regex patterns miss.
 *
 * NOTE: Keep deterministic + testable. NO LLM usage.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlCanonicalKey =
  | "GROSS_REVENUE"
  | "NET_REVENUE"
  | "COGS"
  | "GROSS_PROFIT"
  | "OPERATING_EXPENSES"
  | "PAYROLL"
  | "RENT"
  | "INSURANCE"
  | "REPAIRS_MAINTENANCE"
  | "INTEREST_EXPENSE"
  | "DEPRECIATION_AMORTIZATION"
  | "PRETAX_INCOME"
  | "NET_INCOME";

export type PlAliasEntry = {
  /** Canonical concept key */
  key: PlCanonicalKey;
  /** Maps to the existing fact_key used by spread templates & backfill */
  factKey: string;
  /** Regex patterns that match this concept in OCR text labels */
  patterns: RegExp[];
};

// ---------------------------------------------------------------------------
// Alias map
// ---------------------------------------------------------------------------

export const PL_ALIASES: PlAliasEntry[] = [
  // COGS / direct costs — MUST come before GROSS_REVENUE so "Cost of Sales"
  // matches here, not via the broad /\bsales\b/ pattern in GROSS_REVENUE.
  {
    key: "COGS",
    factKey: "COST_OF_GOODS_SOLD",
    patterns: [
      /cost\s+of\s+goods/i,
      /cost\s+of\s+sales/i,
      /cost\s+of\s+revenue/i,
      /direct\s+costs?/i,
      /\bcogs\b/i,
      /merchant\s+fees?/i,
      /materials?\s+cost/i,
    ],
  },

  // Revenue (operating company + service + niche)
  {
    key: "GROSS_REVENUE",
    factKey: "TOTAL_REVENUE",
    patterns: [
      /\brevenue\b/i,
      /total\s+revenue/i,
      /gross\s+receipts/i,
      /\bsales\b/i,
      /net\s+sales/i,
      /sales\s+revenue/i,
      /service\s+revenue/i,
      /charter/i,
      /contract\s+revenue/i,
      /operating\s+revenue/i,
      /fee\s+income/i,
    ],
  },

  // Gross profit
  {
    key: "GROSS_PROFIT",
    factKey: "GROSS_PROFIT",
    patterns: [
      /gross\s+profit/i,
      /gross\s+margin/i,
    ],
  },

  // Total operating expenses
  {
    key: "OPERATING_EXPENSES",
    factKey: "TOTAL_OPERATING_EXPENSES",
    patterns: [
      /total\s+(?:operating\s+)?expenses/i,
      /total\s+opex/i,
      /^operating\s+expenses$/i,
    ],
  },

  // Common opex buckets
  {
    key: "PAYROLL",
    factKey: "PAYROLL",
    patterns: [
      /payroll/i,
      /\bwages\b/i,
      /salaries/i,
      /\blabor\b/i,
      /employee\s+(?:cost|expense)/i,
    ],
  },
  {
    key: "RENT",
    factKey: "OTHER_OPEX",
    patterns: [
      /\brent\b(?!\s+roll)/i,
      /\blease\s+(?:expense|payment)/i,
      /occupancy\s+(?:cost|expense)/i,
    ],
  },
  {
    key: "INSURANCE",
    factKey: "INSURANCE",
    patterns: [
      /\binsurance\b(?!\s+(?:income|value|surrender))/i,
    ],
  },
  {
    key: "REPAIRS_MAINTENANCE",
    factKey: "REPAIRS_MAINTENANCE",
    patterns: [
      /repairs?\s*(?:&|and)?\s*maint/i,
      /\bR&M\b/i,
      /marina\s+svcs/i,
    ],
  },

  // Below-the-line
  {
    key: "INTEREST_EXPENSE",
    factKey: "DEBT_SERVICE",
    patterns: [
      /interest\s+(?:expense|paid)/i,
      /debt\s+service/i,
      /loan\s+payment/i,
    ],
  },
  {
    key: "DEPRECIATION_AMORTIZATION",
    factKey: "DEPRECIATION",
    patterns: [
      /depreciation/i,
      /amortization/i,
      /D&A/i,
    ],
  },

  // Pre-tax
  {
    key: "PRETAX_INCOME",
    factKey: "OPERATING_INCOME",
    patterns: [
      /(?:income|profit|earnings)\s+(?:from\s+operations|before\s+(?:income\s+)?tax)/i,
      /operating\s+(?:income|profit|earnings)/i,
      /pre[\s-]?tax\s+(?:income|profit)/i,
      /\bEBT\b/i,
    ],
  },

  // Bottom line
  {
    key: "NET_INCOME",
    factKey: "NET_INCOME",
    patterns: [
      /net\s+(?:income|profit|loss)/i,
      /profit\s*\(loss\)/i,
      /bottom\s+line/i,
    ],
  },
];

// ---------------------------------------------------------------------------
// Normalizer function
// ---------------------------------------------------------------------------

/**
 * Normalize an OCR label string into a canonical P&L concept.
 * Returns the first matching PlAliasEntry, or null if none match.
 */
export function normalizePlLabel(label: string): PlAliasEntry | null {
  const trimmed = label.trim();
  if (!trimmed) return null;

  for (const entry of PL_ALIASES) {
    for (const pattern of entry.patterns) {
      if (pattern.test(trimmed)) {
        return entry;
      }
    }
  }

  return null;
}
