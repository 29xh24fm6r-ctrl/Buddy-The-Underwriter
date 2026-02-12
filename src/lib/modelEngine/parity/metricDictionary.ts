/**
 * Model Engine V2 — Canonical Parity Metric Dictionary
 *
 * Single source of truth for parity comparison metrics.
 * All parity tooling references this dictionary. Adding or removing
 * metrics here requires updating:
 * - parityTargets.ts (V1/V2 extractors)
 * - parityCompare.ts (PeriodDifferences interface)
 * - Tests (dictionary freeze test)
 */

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

export interface ParityMetricDefinition {
  key: string;
  category: "income_statement" | "balance_sheet" | "derived";
  description: string;
}

/**
 * Canonical list of parity metrics. Readonly tuple — frozen at 10 metrics.
 * DO NOT add metrics without updating all downstream consumers and re-running parity validation.
 */
export const CANONICAL_PARITY_METRICS = [
  { key: "revenue", category: "income_statement", description: "Total revenue or gross rental income" },
  { key: "cogs", category: "income_statement", description: "Cost of goods sold" },
  { key: "operatingExpenses", category: "income_statement", description: "Total operating expenses" },
  { key: "ebitda", category: "income_statement", description: "EBITDA (or NOI for real estate)" },
  { key: "netIncome", category: "income_statement", description: "Net income" },
  { key: "cash", category: "balance_sheet", description: "Cash and cash equivalents" },
  { key: "totalAssets", category: "balance_sheet", description: "Total assets" },
  { key: "totalLiabilities", category: "balance_sheet", description: "Total liabilities" },
  { key: "equity", category: "balance_sheet", description: "Total equity (shareholders' equity)" },
  { key: "leverageDebtToEbitda", category: "derived", description: "Total debt / EBITDA leverage ratio" },
] as const satisfies readonly ParityMetricDefinition[];

/**
 * Typed union of canonical parity metric keys.
 */
export type CanonicalParityMetricKey = (typeof CANONICAL_PARITY_METRICS)[number]["key"];

/**
 * Readonly tuple of just the metric key strings.
 * Use this wherever you need to iterate over metric keys.
 */
export const CANONICAL_PARITY_METRIC_KEYS = CANONICAL_PARITY_METRICS.map((m) => m.key) as unknown as readonly CanonicalParityMetricKey[];

/**
 * Expected count — use in tests to detect accidental additions/removals.
 */
export const EXPECTED_METRIC_COUNT = 10;
