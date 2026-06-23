/**
 * Financial Statement Period Review — Detection
 *
 * Pure helper that determines whether a document needs manual period review.
 * A document needs review when its canonical type is known (BALANCE_SHEET,
 * INCOME_STATEMENT, etc.) but its checklist_key cannot be resolved because
 * the reporting period is ambiguous.
 *
 * This is NOT a classification bug — the classifier correctly identified the
 * document type. It is a period-resolution problem that requires human input.
 *
 * Pure function — no DB, no server-only.
 */

/** Generic checklist keys that do NOT satisfy readiness — they indicate unresolved period. */
export const GENERIC_FINANCIAL_CHECKLIST_KEYS = new Set([
  "BALANCE_SHEET",
  "INCOME_STATEMENT",
  "FINANCIAL_STATEMENT",
]);

/** Resolved checklist keys that DO satisfy readiness. */
export const RESOLVED_FINANCIAL_CHECKLIST_KEYS = new Set([
  "FIN_STMT_BS_CURRENT",
  "FIN_STMT_BS_HISTORICAL",
  "FIN_STMT_PL_YTD",
  "FIN_STMT_PL_ANNUAL",
]);

/** Canonical types eligible for financial period review. */
const PERIOD_REVIEW_CANONICAL_TYPES = new Set([
  "BALANCE_SHEET",
  "INCOME_STATEMENT",
  "FINANCIAL_STATEMENT",
]);

export type FinancialPeriodReviewCandidate = {
  documentId: string;
  dealId: string;
  documentType: string | null;
  canonicalType: string | null;
  checklistKey: string | null;
  statementPeriod: string | null;
  filename: string | null;
  displayName: string | null;
  reason: string;
};

export type PeriodReviewInput = {
  canonicalType: string | null;
  checklistKey: string | null;
  statementPeriod: string | null;
};

/**
 * Returns true if the document needs manual financial period review.
 */
export function needsFinancialPeriodReview(input: PeriodReviewInput): boolean {
  return getFinancialPeriodReviewReason(input) !== null;
}

/**
 * Returns a human-readable reason if the document needs period review, or null if resolved.
 */
export function getFinancialPeriodReviewReason(input: PeriodReviewInput): string | null {
  const { canonicalType, checklistKey, statementPeriod } = input;

  // Only period-review-eligible canonical types
  if (!canonicalType || !PERIOD_REVIEW_CANONICAL_TYPES.has(canonicalType)) {
    return null;
  }

  // Generic FINANCIAL_STATEMENT always needs review — it could be BS, IS, or other
  if (canonicalType === "FINANCIAL_STATEMENT") {
    return "Generic FINANCIAL_STATEMENT requires sub-type and period confirmation.";
  }

  // BALANCE_SHEET with generic or missing checklist key
  if (canonicalType === "BALANCE_SHEET") {
    if (!checklistKey || GENERIC_FINANCIAL_CHECKLIST_KEYS.has(checklistKey)) {
      return "Balance sheet period not resolved — CURRENT or HISTORICAL confirmation required.";
    }
    if (!RESOLVED_FINANCIAL_CHECKLIST_KEYS.has(checklistKey)) {
      return `Balance sheet has non-standard checklist_key '${checklistKey}' — period review recommended.`;
    }
    return null;
  }

  // INCOME_STATEMENT with generic or missing checklist key
  if (canonicalType === "INCOME_STATEMENT") {
    if (!checklistKey || GENERIC_FINANCIAL_CHECKLIST_KEYS.has(checklistKey)) {
      return "Income statement period not resolved — YTD or ANNUAL confirmation required.";
    }
    if (!RESOLVED_FINANCIAL_CHECKLIST_KEYS.has(checklistKey)) {
      return `Income statement has non-standard checklist_key '${checklistKey}' — period review recommended.`;
    }
    return null;
  }

  return null;
}
