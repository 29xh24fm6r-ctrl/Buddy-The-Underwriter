import type { ChecklistRuleSet } from "./types";

export const RULESETS: ChecklistRuleSet[] = [
  {
    key: "CRE_OWNER_OCCUPIED_V1",
    loan_type_norm: "CRE_OWNER_OCCUPIED",
    version: 1,
    items: [
      { checklist_key: "FIN_STMT_YTD", title: "Year-to-date financial statement", required: true, category: "Financials" },
      { checklist_key: "IRS_BUSINESS_2Y", title: "Business tax returns (last 2 years)", required: true, category: "Tax" },
      { checklist_key: "IRS_PERSONAL_2Y", title: "Personal tax returns (last 2 years)", required: true, category: "Tax" },
      { checklist_key: "BANK_STMT_3M", title: "Bank statements (last 3 months)", required: true, category: "Banking" },
      { checklist_key: "AR_AP_AGING", title: "A/R & A/P aging", required: false, category: "Financials" },
      { checklist_key: "PFS_CURRENT", title: "Personal Financial Statement (current)", required: true, category: "Owner" },
      { checklist_key: "RENT_ROLL", title: "Rent roll", required: false, category: "Property" },
      { checklist_key: "PROPERTY_TAX", title: "Property tax bill", required: false, category: "Property" },
      { checklist_key: "INSURANCE", title: "Insurance declarations page", required: false, category: "Property" },
      { checklist_key: "ORG_DOCS", title: "Organizational documents", required: true, category: "Entity" },
      { checklist_key: "DEBT_SCHED", title: "Debt schedule", required: false, category: "Financials" },
      { checklist_key: "BTR_2Y", title: "Business tax return PDFs (BTR 2 years)", required: true, category: "Tax" },
    ],
  },
  {
    key: "CRE_INVESTOR_V1",
    loan_type_norm: "CRE_INVESTOR",
    version: 1,
    items: [
      { checklist_key: "RENT_ROLL", title: "Rent roll (current)", required: true, category: "Property" },
      { checklist_key: "PROPERTY_T12", title: "Trailing 12-month property operating statement", required: true, category: "Property" },
      { checklist_key: "LEASES_TOP", title: "Major leases (top tenants)", required: true, category: "Property" },
      { checklist_key: "PROPERTY_USE_STATEMENT", title: "Property use statement / occupancy plan", required: false, category: "Property" },
      { checklist_key: "REAL_ESTATE_TAX_BILL", title: "Real estate tax bill", required: false, category: "Property" },
      { checklist_key: "PROPERTY_INSURANCE", title: "Property insurance declarations page", required: true, category: "Property" },
      { checklist_key: "APPRAISAL_IF_AVAILABLE", title: "Appraisal (if available)", required: false, category: "Property" },
      { checklist_key: "IRS_BUSINESS_2Y", title: "Business tax returns (last 2 years)", required: true, category: "Tax" },
      { checklist_key: "IRS_PERSONAL_2Y", title: "Personal tax returns (last 2 years)", required: true, category: "Tax" },
      { checklist_key: "FIN_STMT_YTD", title: "Year-to-date financial statement", required: true, category: "Financials" },
      { checklist_key: "PFS_CURRENT", title: "Personal Financial Statement (current)", required: true, category: "Owner" },
      { checklist_key: "BANK_STMT_3M", title: "Bank statements (last 3 months)", required: false, category: "Banking" },
    ],
  },
];
