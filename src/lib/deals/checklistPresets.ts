// src/lib/deals/checklistPresets.ts
import "server-only";

export type LoanType = "CRE" | "LOC" | "TERM" | "SBA_7A" | "SBA_504";

export type ChecklistSeedRow = {
  checklist_key: string;
  title: string;
  required: boolean;
  description?: string | null;
};

export function buildChecklistForLoanType(loanType: LoanType): ChecklistSeedRow[] {
  // Deterministic. No LLM. Bulletproof defaults.
  const CORE: ChecklistSeedRow[] = [
    { checklist_key: "PFS_CURRENT", title: "Personal Financial Statement (current)", required: true },
    { checklist_key: "IRS_PERSONAL_2Y", title: "Personal tax returns (last 2 years)", required: true },
    { checklist_key: "IRS_BUSINESS_2Y", title: "Business tax returns (last 2 years)", required: true },
    { checklist_key: "FIN_STMT_YTD", title: "Year-to-date financial statement", required: true },
    { checklist_key: "BANK_STMT_3M", title: "Bank statements (last 3 months)", required: false },
  ];

  const CRE: ChecklistSeedRow[] = [
    { checklist_key: "RENT_ROLL", title: "Rent roll (current)", required: true },
    { checklist_key: "LEASES_TOP", title: "Major leases (top tenants)", required: true },
    { checklist_key: "PROPERTY_T12", title: "Trailing 12-month property operating statement", required: true },
    { checklist_key: "PROPERTY_INSURANCE", title: "Property insurance declarations page", required: true },
    { checklist_key: "REAL_ESTATE_TAX_BILL", title: "Real estate tax bill", required: false },
    { checklist_key: "APPRAISAL_IF_AVAILABLE", title: "Appraisal (if available)", required: false },
  ];

  const LOC: ChecklistSeedRow[] = [
    { checklist_key: "AR_AGING", title: "A/R aging", required: true },
    { checklist_key: "AP_AGING", title: "A/P aging", required: true },
    { checklist_key: "BORROWING_BASE_CERT", title: "Borrowing base certificate (most recent)", required: true },
    { checklist_key: "INVENTORY_REPORT", title: "Inventory report (if applicable)", required: false },
  ];

  const TERM: ChecklistSeedRow[] = [
    { checklist_key: "DEBT_SCHEDULE", title: "Business debt schedule", required: true },
    { checklist_key: "USES_OF_FUNDS", title: "Uses of funds / invoice support", required: false },
  ];

  const SBA_7A: ChecklistSeedRow[] = [
    { checklist_key: "SBA_1919", title: "SBA Form 1919", required: true },
    { checklist_key: "SBA_413", title: "SBA Form 413 (PFS)", required: true },
    { checklist_key: "SBA_DEBT_SCHED", title: "Business debt schedule", required: true },
    { checklist_key: "SBA_912", title: "SBA Form 912 (if required)", required: false },
  ];

  const SBA_504: ChecklistSeedRow[] = [
    { checklist_key: "SBA_1244", title: "SBA Form 1244", required: true },
    { checklist_key: "SBA_413", title: "SBA Form 413 (PFS)", required: true },
    { checklist_key: "PROJECT_SOURCES_USES", title: "Project sources & uses", required: true },
    { checklist_key: "CONTRACTOR_BIDS", title: "Contractor bids / construction budget", required: false },
  ];

  switch (loanType) {
    case "CRE":
      return [...CORE, ...CRE];
    case "LOC":
      return [...CORE, ...LOC];
    case "TERM":
      return [...CORE, ...TERM];
    case "SBA_7A":
      return [...CORE, ...SBA_7A];
    case "SBA_504":
      return [...CORE, ...SBA_504];
    default:
      return CORE;
  }
}
