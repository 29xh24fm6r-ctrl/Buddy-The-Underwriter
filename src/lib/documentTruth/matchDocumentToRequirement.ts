// Pure function. No DB. No side effects. No network.
// THE ONLY matcher in the system — no other component may independently derive
// requirement satisfaction from files.

import type { RequirementCode } from "./requirementRegistry";

export type PartyScope = "business" | "guarantor" | "collateral" | "property";

export type ChecklistStatus = "missing" | "received" | "satisfied" | "waived";
export type ValidationStatus = "pending" | "valid" | "invalid";
export type ReviewStatus = "unreviewed" | "confirmed" | "rejected";
export type ReadinessStatus = "blocking" | "warning" | "complete" | "optional";

export type MatchResult = {
  requirementCode: RequirementCode | null;
  checklistStatus: ChecklistStatus;
  validationStatus: ValidationStatus;
  readinessStatus: ReadinessStatus;
  reasons: string[];
};

// Map from classified document types to requirement codes
const DOC_TYPE_TO_REQUIREMENT: Record<string, RequirementCode> = {
  // Business tax returns
  IRS_BUSINESS: "financials.business_tax_returns",
  BUSINESS_TAX_RETURN: "financials.business_tax_returns",
  "1120": "financials.business_tax_returns",
  "1065": "financials.business_tax_returns",
  "1120S": "financials.business_tax_returns",

  // Personal tax returns
  IRS_PERSONAL: "financials.personal_tax_returns",
  PERSONAL_TAX_RETURN: "financials.personal_tax_returns",
  "1040": "financials.personal_tax_returns",

  // Income statement
  INCOME_STATEMENT: "financials.ytd_income_statement",
  T12: "financials.ytd_income_statement",
  PROFIT_AND_LOSS: "financials.ytd_income_statement",

  // Balance sheet
  BALANCE_SHEET: "financials.current_balance_sheet",

  // Personal financial statement
  PFS: "financials.personal_financial_statement",
  PERSONAL_FINANCIAL_STATEMENT: "financials.personal_financial_statement",

  // Collateral
  APPRAISAL: "collateral.appraisal",

  // Liquidity
  BANK_STATEMENT: "liquidity.bank_statements",

  // Property
  RENT_ROLL: "property.rent_roll",
  OPERATING_STATEMENT: "property.operating_statement",
  REAL_ESTATE_TAX_BILL: "property.real_estate_tax_bill",
  INSURANCE: "property.insurance",

  // Legal
  LEASE: "legal.major_leases",
};

/**
 * Match a classified document to a requirement code.
 * This is the ONLY function in the system that performs this mapping.
 *
 * Known matching rules:
 * - INCOME_STATEMENT maps to financials.ytd_income_statement
 * - PERSONAL_TAX_RETURN must bind to specific guarantor via subject_id
 * - Business tax returns require year to determine consecutive year satisfaction
 */
export function matchDocumentToRequirement(params: {
  classifiedType: string | null;
  year?: number | null;
  subjectId?: string | null;
  partyScope: PartyScope;
  reviewStatus: ReviewStatus;
}): MatchResult {
  const { classifiedType, year, subjectId, partyScope, reviewStatus } = params;

  // No classification → unmatched
  if (!classifiedType) {
    return {
      requirementCode: null,
      checklistStatus: "missing",
      validationStatus: "pending",
      readinessStatus: "blocking",
      reasons: ["Document has no classification"],
    };
  }

  const requirementCode = DOC_TYPE_TO_REQUIREMENT[classifiedType] ?? null;

  if (!requirementCode) {
    return {
      requirementCode: null,
      checklistStatus: "missing",
      validationStatus: "pending",
      readinessStatus: "blocking",
      reasons: [`Unknown document type: ${classifiedType}`],
    };
  }

  const reasons: string[] = [];

  // Validation checks
  let validationStatus: ValidationStatus = "pending";

  // Personal tax returns require subject binding
  if (
    requirementCode === "financials.personal_tax_returns" &&
    !subjectId
  ) {
    validationStatus = "invalid";
    reasons.push("Personal tax return has no guarantor binding (subject_id)");
  }

  // Tax returns require year
  if (
    (requirementCode === "financials.business_tax_returns" ||
      requirementCode === "financials.personal_tax_returns") &&
    !year
  ) {
    validationStatus = "invalid";
    reasons.push("Tax return missing year — cannot determine consecutive year satisfaction");
  }

  // If review confirmed and no validation issues → valid
  if (validationStatus === "pending" && reviewStatus === "confirmed") {
    validationStatus = "valid";
  }

  // Checklist status
  let checklistStatus: ChecklistStatus = "received";
  if (validationStatus === "valid" && reviewStatus === "confirmed") {
    checklistStatus = "satisfied";
  }

  // Readiness status
  let readinessStatus: ReadinessStatus = "warning";
  if (checklistStatus === "satisfied") {
    readinessStatus = "complete";
  } else if (reviewStatus === "rejected") {
    readinessStatus = "blocking";
  }

  return {
    requirementCode,
    checklistStatus,
    validationStatus,
    readinessStatus,
    reasons,
  };
}
