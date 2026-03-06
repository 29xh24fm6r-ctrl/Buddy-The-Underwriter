import type { ReconciliationCheck } from "./types";

/**
 * Verify assets = liabilities + equity.
 * Pure function — no DB.
 */
export function checkBalanceSheet(params: {
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  sourceName: string;
}): ReconciliationCheck {
  const { totalAssets, totalLiabilities, totalEquity, sourceName } = params;

  if (totalAssets === null || totalLiabilities === null || totalEquity === null) {
    const missing: string[] = [];
    if (totalAssets === null) missing.push("total assets");
    if (totalLiabilities === null) missing.push("total liabilities");
    if (totalEquity === null) missing.push("total equity");
    return {
      checkId: "BALANCE_SHEET",
      description: `Balance sheet integrity (${sourceName})`,
      status: "SKIPPED",
      severity: "HARD",
      skipReason: `Missing: ${missing.join(", ")}`,
      lhsLabel: "Total Assets",
      lhsValue: null,
      rhsLabel: "Total Liabilities + Total Equity",
      rhsValue: null,
      delta: null,
      toleranceAmount: null,
      notes: "",
    };
  }

  const expected = totalLiabilities + totalEquity;
  const delta = Math.abs(totalAssets - expected);
  const passed = delta <= 1;

  return {
    checkId: "BALANCE_SHEET",
    description: `Balance sheet integrity (${sourceName})`,
    status: passed ? "PASSED" : "FAILED",
    severity: "HARD",
    lhsLabel: "Total Assets",
    lhsValue: totalAssets,
    rhsLabel: "Total Liabilities + Total Equity",
    rhsValue: expected,
    delta,
    toleranceAmount: 1,
    notes: passed
      ? ""
      : "Balance sheet does not balance. Extraction error or incomplete Schedule L likely. Verify all liability and equity line items were captured.",
  };
}
