import type { ReconciliationCheck } from "./types";

/**
 * Compare tax return revenue to financial statement revenue.
 * Pure function — no DB.
 */
export function checkTaxToFinancials(params: {
  taxRevenue: number | null;
  financialStatementRevenue: number | null;
  entityName: string;
  taxYear: number;
}): ReconciliationCheck {
  const { taxRevenue, financialStatementRevenue, entityName, taxYear } = params;

  if (taxRevenue === null || financialStatementRevenue === null) {
    const missing = taxRevenue === null ? "tax return revenue" : "financial statement revenue";
    return {
      checkId: "TAX_TO_FINANCIALS",
      description: `Tax return vs financial statement revenue for ${entityName} (${taxYear})`,
      status: "SKIPPED",
      severity: "SOFT",
      skipReason: `Missing ${missing}`,
      lhsLabel: "Tax Return Revenue",
      lhsValue: null,
      rhsLabel: "Financial Statement Revenue",
      rhsValue: null,
      delta: null,
      toleranceAmount: null,
      notes: "",
    };
  }

  const tolerance = Math.max(taxRevenue, financialStatementRevenue) * 0.05;
  const delta = Math.abs(taxRevenue - financialStatementRevenue);
  const passed = delta <= tolerance;

  return {
    checkId: "TAX_TO_FINANCIALS",
    description: `Tax return vs financial statement revenue for ${entityName} (${taxYear})`,
    status: passed ? "PASSED" : "FAILED",
    severity: "SOFT",
    lhsLabel: "Tax Return Revenue",
    lhsValue: taxRevenue,
    rhsLabel: "Financial Statement Revenue",
    rhsValue: financialStatementRevenue,
    delta,
    toleranceAmount: tolerance,
    notes: passed
      ? ""
      : "5% tolerance applied for cash vs accrual method differences. Larger discrepancies may indicate different entity periods or mismatched documents.",
  };
}
