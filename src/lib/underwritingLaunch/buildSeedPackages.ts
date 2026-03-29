// Pure function. No DB. No side effects. No network.
import type { SpreadSeedPackage, MemoSeedPackage } from "./types";

type SnapshotData = {
  snapshotId: string;
  borrowerLegalName: string;
  borrowerEntityType?: string | null;
  dealName: string;
  bankName: string;
  launchedAt: string;
  launchedBy: string;
  handoffNote?: string | null;
  loanRequest: {
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
  confirmedDocuments: Array<{
    requirementCode: string;
    documentId: string;
    fileName: string;
    canonicalDocType: string;
    periodYear?: number | null;
  }>;
};

/**
 * Build spread seed package from launch snapshot data.
 * Only confirmed/accepted snapshot documents should seed spreads.
 */
export function buildSpreadSeedPackage(data: SnapshotData): SpreadSeedPackage {
  const financialDocs = data.confirmedDocuments.filter((d) =>
    d.requirementCode.startsWith("financials."),
  );

  const btrYears = financialDocs
    .filter((d) => d.requirementCode === "financials.business_tax_returns" && d.periodYear)
    .map((d) => d.periodYear!)
    .sort();

  const ptrYears = financialDocs
    .filter((d) => d.requirementCode === "financials.personal_tax_returns" && d.periodYear)
    .map((d) => d.periodYear!)
    .sort();

  return {
    snapshotId: data.snapshotId,
    borrower: {
      legalName: data.borrowerLegalName,
      entityType: data.borrowerEntityType,
    },
    financialDocuments: financialDocs.map((d) => ({
      requirementCode: d.requirementCode,
      documentId: d.documentId,
      fileName: d.fileName,
      canonicalDocType: d.canonicalDocType,
      periodYear: d.periodYear,
      periodLabel: d.periodYear ? String(d.periodYear) : null,
    })),
    financialPeriodSummary: {
      businessTaxReturnYears: btrYears,
      personalTaxReturnYears: ptrYears,
      hasYtdIncomeStatement: financialDocs.some(
        (d) => d.requirementCode === "financials.ytd_income_statement",
      ),
      hasCurrentBalanceSheet: financialDocs.some(
        (d) => d.requirementCode === "financials.current_balance_sheet",
      ),
      hasPfs: financialDocs.some(
        (d) => d.requirementCode === "financials.personal_financial_statement",
      ),
    },
    loanRequest: {
      loanAmount: data.loanRequest.loanAmount,
      loanType: data.loanRequest.loanType,
      facilityPurpose: data.loanRequest.facilityPurpose,
      collateralType: data.loanRequest.collateralType,
    },
  };
}

/**
 * Build memo seed package from launch snapshot data.
 */
export function buildMemoSeedPackage(data: SnapshotData): MemoSeedPackage {
  const docs = data.confirmedDocuments;

  return {
    snapshotId: data.snapshotId,
    deal: {
      dealName: data.dealName,
      borrowerLegalName: data.borrowerLegalName,
      bankName: data.bankName,
    },
    request: {
      loanAmount: data.loanRequest.loanAmount,
      loanType: data.loanRequest.loanType,
      loanPurpose: data.loanRequest.loanPurpose,
      facilityPurpose: data.loanRequest.facilityPurpose,
      collateralType: data.loanRequest.collateralType,
      termMonths: data.loanRequest.termMonths,
      amortizationMonths: data.loanRequest.amortizationMonths,
      interestType: data.loanRequest.interestType,
      recourseType: data.loanRequest.recourseType,
    },
    intakeSupportingDocs: {
      businessTaxReturnYears: docs
        .filter((d) => d.requirementCode === "financials.business_tax_returns" && d.periodYear)
        .map((d) => d.periodYear!)
        .sort(),
      personalTaxReturnYears: docs
        .filter((d) => d.requirementCode === "financials.personal_tax_returns" && d.periodYear)
        .map((d) => d.periodYear!)
        .sort(),
      currentFinancialsPresent:
        docs.some((d) => d.requirementCode === "financials.ytd_income_statement") &&
        docs.some((d) => d.requirementCode === "financials.current_balance_sheet"),
      liquidityDocsPresent: docs.some((d) => d.requirementCode === "liquidity.bank_statements"),
      collateralDocsPresent: docs.some((d) => d.requirementCode === "collateral.appraisal"),
    },
    launchContext: {
      launchedAt: data.launchedAt,
      launchedBy: data.launchedBy,
      handoffNote: data.handoffNote,
    },
  };
}
