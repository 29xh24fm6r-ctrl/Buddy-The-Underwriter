/**
 * Spread Preflight — pure checker.
 *
 * Pure module. No `server-only`, no DB. Safe to import from CI guard tests.
 * The server-side wrapper at `./spreadPreflight.ts` loads facts and source
 * documents, then delegates to this checker.
 *
 * Goal (P0b): Classic Spreads must never produce a successful empty PDF.
 * This pure function decides whether the loaded spread input has enough
 * data to render meaningfully. The shape mirrors the renderer's empty
 * branches in `src/lib/classicSpread/classicSpreadRenderer.ts` (lines
 * 837–847 for balance sheet and 857–867 for income statement) — when those
 * branches would emit "data not available", we block instead of rendering.
 */

export type SpreadPreflightInput = {
  /** Number of balance-sheet rows the loader produced. 0 = renderer would emit "Balance sheet data not available". */
  balanceSheetRowCount: number;
  /** Number of income-statement rows the loader produced. 0 = renderer would emit "Income statement data not available". */
  incomeStatementRowCount: number;
  /** Distinct source_document_ids that contributed any fact for this deal. Surfaced to the UI so the banker can see what was processed. */
  sourceDocuments: string[];
};

export type SpreadPreflightOk = {
  status: "ok";
};

export type SpreadPreflightBlocked = {
  status: "blocked";
  reason: "missing_financial_facts";
  /**
   * Conceptual fact keys / sections that are missing. Order matters for
   * UI display: section labels first, then specific keys within the section.
   */
  missingFacts: string[];
  /** Distinct source documents that were processed but didn't yield required facts. */
  sourceDocuments: string[];
  /** Stable user-facing message — keep aligned with the spec wording. */
  userMessage: string;
};

export type SpreadPreflightResult = SpreadPreflightOk | SpreadPreflightBlocked;

const USER_MESSAGE =
  "Financial extraction completed, but spreads cannot be generated yet.";

/**
 * Decide whether spread rendering is allowed.
 *
 * Rules:
 *  - Balance sheet must have ≥1 row. Otherwise BALANCE_SHEET / TOTAL_ASSETS
 *    are reported as missing.
 *  - Income statement must have ≥1 row. Otherwise INCOME_STATEMENT / REVENUE
 *    / NET_INCOME are reported as missing.
 *  - Both must be present for `status: "ok"`. Either-or → still blocked
 *    (a balance sheet without an income statement, or vice versa, isn't
 *    a useful spread).
 *
 * Pure: no I/O, no fact lookups. The server wrapper translates DB state
 * into the shape required here.
 */
export function checkSpreadPreflight(
  input: SpreadPreflightInput,
): SpreadPreflightResult {
  const missing: string[] = [];

  if (input.balanceSheetRowCount <= 0) {
    missing.push("BALANCE_SHEET", "TOTAL_ASSETS");
  }
  if (input.incomeStatementRowCount <= 0) {
    missing.push("INCOME_STATEMENT", "REVENUE", "NET_INCOME");
  }

  if (missing.length === 0) {
    return { status: "ok" };
  }

  return {
    status: "blocked",
    reason: "missing_financial_facts",
    missingFacts: missing,
    sourceDocuments: input.sourceDocuments,
    userMessage: USER_MESSAGE,
  };
}
