/**
 * Phase 65I — Monitoring Catalog
 *
 * Borrower-safe templates for recurring post-close asks.
 * Plain English only. No internal risk framing. No blocker jargon.
 */

import type { MonitoringObligationType } from "./types";

export type MonitoringRequestTemplate = {
  title: string;
  description: string;
  evidenceType: "document_submit" | "document_upload" | "field_confirmation";
};

export const MONITORING_REQUEST_CATALOG: Record<
  string,
  MonitoringRequestTemplate
> = {
  annual_financials: {
    title: "Upload Annual Financial Statements",
    description:
      "Please upload the annual financial statements requested for your loan relationship.",
    evidenceType: "document_submit",
  },
  quarterly_borrowing_base: {
    title: "Upload Borrowing Base Report",
    description:
      "Please upload the current borrowing base report requested for your loan relationship.",
    evidenceType: "document_submit",
  },
  covenant_certificate: {
    title: "Upload Covenant Certificate",
    description:
      "Please provide the requested covenant compliance certificate.",
    evidenceType: "document_submit",
  },
  annual_tax_return: {
    title: "Upload Tax Returns",
    description: "Please upload the requested tax return documents.",
    evidenceType: "document_submit",
  },
  insurance_certificate: {
    title: "Upload Insurance Certificate",
    description:
      "Please upload the current certificate of insurance for your loan relationship.",
    evidenceType: "document_submit",
  },
  rent_roll: {
    title: "Upload Rent Roll",
    description:
      "Please upload the current rent roll for the property securing your loan.",
    evidenceType: "document_submit",
  },
  aging_report: {
    title: "Upload Aging Report",
    description:
      "Please upload the current accounts receivable and payable aging report.",
    evidenceType: "document_submit",
  },
};

/**
 * Maps obligation type to catalog key for borrower request generation.
 */
export const OBLIGATION_TYPE_TO_CATALOG_KEY: Partial<
  Record<MonitoringObligationType, string>
> = {
  financial_reporting: "annual_financials",
  borrowing_base: "quarterly_borrowing_base",
  covenant_certificate: "covenant_certificate",
  tax_return: "annual_tax_return",
  insurance: "insurance_certificate",
  rent_roll: "rent_roll",
  aging_report: "aging_report",
};

/**
 * Maps existing deal_reporting_requirements.requirement text
 * to obligation types for seeding.
 */
export const REPORTING_REQUIREMENT_MAP: Record<string, {
  type: MonitoringObligationType;
  isFinancialReporting: boolean;
  isCovenantRelated: boolean;
  isAnnualReviewInput: boolean;
}> = {
  "annual financial statements": {
    type: "financial_reporting",
    isFinancialReporting: true,
    isCovenantRelated: false,
    isAnnualReviewInput: true,
  },
  "quarterly financial statements": {
    type: "financial_reporting",
    isFinancialReporting: true,
    isCovenantRelated: false,
    isAnnualReviewInput: false,
  },
  "borrowing base report": {
    type: "borrowing_base",
    isFinancialReporting: false,
    isCovenantRelated: true,
    isAnnualReviewInput: false,
  },
  "covenant compliance certificate": {
    type: "covenant_certificate",
    isFinancialReporting: false,
    isCovenantRelated: true,
    isAnnualReviewInput: false,
  },
  "tax return": {
    type: "tax_return",
    isFinancialReporting: true,
    isCovenantRelated: false,
    isAnnualReviewInput: true,
  },
  "insurance certificate": {
    type: "insurance",
    isFinancialReporting: false,
    isCovenantRelated: false,
    isAnnualReviewInput: false,
  },
  "rent roll": {
    type: "rent_roll",
    isFinancialReporting: false,
    isCovenantRelated: false,
    isAnnualReviewInput: true,
  },
  "aging report": {
    type: "aging_report",
    isFinancialReporting: false,
    isCovenantRelated: false,
    isAnnualReviewInput: false,
  },
};

/**
 * Maps existing deal_covenants.testing_frequency to MonitoringCadence.
 */
export function mapTestingFrequencyToCadence(
  freq: string,
): "monthly" | "quarterly" | "annual" {
  switch (freq) {
    case "monthly":
      return "monthly";
    case "quarterly":
      return "quarterly";
    case "annually":
      return "annual";
    default:
      return "annual";
  }
}
