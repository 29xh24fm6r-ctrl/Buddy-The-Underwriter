export type ReconciliationCheckId =
  | "K1_TO_ENTITY"
  | "K1_TO_PERSONAL"
  | "TAX_TO_FINANCIALS"
  | "BALANCE_SHEET"
  | "MULTI_YEAR_TREND"
  | "OWNERSHIP_INTEGRITY";

export type ReconciliationSeverity = "HARD" | "SOFT";

export type ReconciliationCheck = {
  checkId: ReconciliationCheckId;
  description: string;
  status: "PASSED" | "FAILED" | "SKIPPED";
  severity: ReconciliationSeverity;
  skipReason?: string;
  lhsLabel: string;
  lhsValue: number | null;
  rhsLabel: string;
  rhsValue: number | null;
  delta: number | null;
  toleranceAmount: number | null;
  notes: string;
};

export type DealReconciliationSummary = {
  dealId: string;
  checksRun: number;
  checksPassed: number;
  checksFailed: number;
  checksSkipped: number;
  hardFailures: ReconciliationCheck[];
  softFlags: ReconciliationCheck[];
  overallStatus: "CLEAN" | "FLAGS" | "CONFLICTS";
  reconciledAt: string;
};
