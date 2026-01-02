import type { ChecklistRuleSet } from "./types";

/**
 * Checklist Engine v2: Rule Sets
 * 
 * Each rule set defines required/optional documents for a loan type.
 * This is a stub - expand with actual rules as needed.
 */

export const RULESETS: ChecklistRuleSet[] = [
  {
    key: "CRE_OWNER_OCCUPIED_V1",
    loan_type_norm: "CRE_OWNER_OCCUPIED",
    version: 1,
    items: [
      {
        checklist_key: "BUSINESS_TAX_RETURN",
        title: "Business Tax Returns",
        required: true,
        description: "3 years of business tax returns",
      },
      {
        checklist_key: "PERSONAL_TAX_RETURN",
        title: "Personal Tax Returns",
        required: true,
        description: "3 years of personal tax returns for owners ≥20%",
      },
      {
        checklist_key: "FINANCIAL_STATEMENT",
        title: "Business Financial Statements",
        required: true,
        description: "Recent balance sheet and P&L",
      },
      {
        checklist_key: "PERSONAL_FINANCIAL_STATEMENT",
        title: "Personal Financial Statement",
        required: true,
        description: "PFS for owners ≥20%",
      },
    ],
  },
  // Add more rule sets as needed
];
