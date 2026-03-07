import type { ChecklistRuleSet } from "./types";

/**
 * Checklist Engine v2: Rule Sets
 *
 * Each rule set defines required/optional documents for a loan type.
 * Keys MUST match the canonical keys used by matchers and UI:
 * - IRS_BUSINESS_3Y, IRS_PERSONAL_3Y (tax returns)
 * - PFS_CURRENT (personal financial statement)
 * - FIN_STMT_PL_YTD, FIN_STMT_BS_YTD (financial statements)
 * - BANK_STMT_3M (bank statements)
 * - etc.
 */

/**
 * Universal/default checklist for any loan type.
 * Used when loan_type is unknown or doesn't match a specific ruleset.
 * Covers the most common required documents.
 */
const UNIVERSAL_ITEMS = [
  {
    checklist_key: "IRS_BUSINESS_3Y",
    title: "Business Tax Returns (3 consecutive years)",
    required: true,
    description: "Most recent 3 consecutive years of business tax returns (1120, 1120S, or 1065)",
  },
  {
    checklist_key: "IRS_PERSONAL_3Y",
    title: "Personal Tax Returns (3 consecutive years)",
    required: true,
    description: "Most recent 3 consecutive years of personal tax returns (1040) for all owners ≥20%",
  },
  {
    checklist_key: "PFS_CURRENT",
    title: "Personal Financial Statement",
    required: true,
    description: "Current personal financial statement for all owners ≥20%",
  },
  {
    checklist_key: "FIN_STMT_PL_YTD",
    title: "Income Statement / P&L (YTD)",
    required: true,
    description: "Year-to-date profit & loss / income statement",
  },
  {
    checklist_key: "FIN_STMT_BS_YTD",
    title: "Balance Sheet (Current)",
    required: true,
    description: "Most recent balance sheet",
  },
];

/**
 * Quick Look — reduced requirements for fast initial analysis.
 * Only 2 years of business tax returns + a YTD financial statement.
 * Personal docs are optional (encouraged, not required).
 */
const QUICK_LOOK_ITEMS = [
  {
    checklist_key: "IRS_BUSINESS_2Y",
    title: "Business Tax Returns (2+ years)",
    required: true,
    description: "Most recent 2 years of business tax returns (3 preferred)",
  },
  {
    checklist_key: "FIN_STMT_YTD",
    title: "YTD Financial Statement (P&L or Balance Sheet)",
    required: true,
    description: "Year-to-date income statement or balance sheet",
  },
  {
    checklist_key: "IRS_PERSONAL_3Y",
    title: "Personal Tax Returns",
    required: false,
    description: "Personal tax returns (optional for quick look)",
  },
  {
    checklist_key: "PFS_CURRENT",
    title: "Personal Financial Statement",
    required: false,
    description: "Personal financial statement (optional for quick look)",
  },
];

export const RULESETS: ChecklistRuleSet[] = [
  // Quick Look - reduced requirements for fast initial analysis
  {
    key: "QUICK_LOOK_V1",
    loan_type_norm: "QUICK_LOOK",
    version: 1,
    items: QUICK_LOOK_ITEMS,
  },
  // Universal/default - used when loan_type is unknown
  {
    key: "UNIVERSAL_V1",
    loan_type_norm: "UNKNOWN",
    version: 1,
    items: UNIVERSAL_ITEMS,
  },
  // CRE Owner-Occupied
  {
    key: "CRE_OWNER_OCCUPIED_V1",
    loan_type_norm: "CRE_OWNER_OCCUPIED",
    version: 1,
    items: [
      ...UNIVERSAL_ITEMS,
      {
        checklist_key: "RENT_ROLL",
        title: "Rent Roll",
        required: false,
        description: "Current rent roll (if property has tenants)",
      },
      {
        checklist_key: "PROPERTY_T12",
        title: "Property Operating Statement",
        required: false,
        description: "Operating statement for the property",
      },
    ],
  },
  // CRE Investor
  {
    key: "CRE_INVESTOR_V1",
    loan_type_norm: "CRE_INVESTOR",
    version: 1,
    items: [
      ...UNIVERSAL_ITEMS,
      {
        checklist_key: "RENT_ROLL",
        title: "Rent Roll",
        required: true,
        description: "Current rent roll with tenant details",
      },
      {
        checklist_key: "PROPERTY_T12",
        title: "Property Operating Statement",
        required: false,
        description: "Operating statement for the property",
      },
      {
        checklist_key: "LEASES_TOP",
        title: "Top Tenant Leases",
        required: false,
        description: "Copies of leases for top tenants",
      },
    ],
  },
];
