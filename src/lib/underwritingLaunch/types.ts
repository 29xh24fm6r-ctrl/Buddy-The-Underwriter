// Phase 56 — Underwriting Launch Control Types
// Zero runtime imports. Pure type definitions only.

export type UnderwritingEligibilityStatus =
  | "not_ready"
  | "eligible"
  | "launched"
  | "launched_with_drift";

export type UnderwritingEligibility = {
  status: UnderwritingEligibilityStatus;
  canLaunch: boolean;
  reasonsNotReady: string[];
  warnings: string[];
  certifiedRequirementCount: number;
  totalApplicableRequiredCount: number;
};

export type UnderwritingWorkspaceStatus =
  | "not_started"
  | "in_progress"
  | "needs_refresh"
  | "completed";

export type DriftSeverity = "warning" | "material";

export type DriftItem = {
  code: string;
  summary: string;
  impact: "memo" | "spreads" | "all_underwriting";
};

export type DriftSummary = {
  hasDrift: boolean;
  severity: DriftSeverity | null;
  items: DriftItem[];
};

export type SpreadSeedPackage = {
  snapshotId: string;
  borrower: {
    legalName: string;
    entityType?: string | null;
  };
  financialDocuments: Array<{
    requirementCode: string;
    documentId: string;
    fileName: string;
    canonicalDocType: string;
    periodYear?: number | null;
    periodLabel?: string | null;
  }>;
  financialPeriodSummary: {
    businessTaxReturnYears: number[];
    personalTaxReturnYears: number[];
    hasYtdIncomeStatement: boolean;
    hasCurrentBalanceSheet: boolean;
    hasPfs: boolean;
  };
  loanRequest: {
    loanAmount?: number | null;
    loanType?: string | null;
    facilityPurpose?: string | null;
    collateralType?: string | null;
  };
};

export type MemoSeedPackage = {
  snapshotId: string;
  deal: {
    dealName: string;
    borrowerLegalName: string;
    bankName: string;
  };
  request: {
    loanAmount?: number | null;
    loanType?: string | null;
    loanPurpose?: string | null;
    facilityPurpose?: string | null;
    collateralType?: string | null;
    termMonths?: number | null;
    amortizationMonths?: number | null;
    interestType?: string | null;
    recourseType?: string | null;
  };
  intakeSupportingDocs: {
    businessTaxReturnYears: number[];
    personalTaxReturnYears: number[];
    currentFinancialsPresent: boolean;
    liquidityDocsPresent: boolean;
    collateralDocsPresent: boolean;
  };
  launchContext: {
    launchedAt: string;
    launchedBy: string;
    handoffNote?: string | null;
  };
};

export type EligibilityInput = {
  blockers: Array<{ code: string }>;
  loanRequestStatus: "missing" | "draft" | "complete";
  hasDealName: boolean;
  hasBorrowerId: boolean;
  hasBankId: boolean;
  applicableRequiredSatisfiedCount: number;
  applicableRequiredTotalCount: number;
  hasExistingWorkspace: boolean;
  hasDrift: boolean;
  dealMode?: "quick_look" | "full_underwrite" | null;
};
