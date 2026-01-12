// src/lib/deals/checklistPresets.ts
import "server-only";

export type LoanType = "CRE" | "CRE_OWNER_OCCUPIED" | "CRE_INVESTOR" | "CRE_OWNER_OCCUPIED_WITH_RENT" | "LOC" | "TERM" | "SBA_7A" | "SBA_504";

// Legacy CRE defaults to owner-occupied for backwards compatibility
export type CRESubtype = "owner_occupied" | "investor" | "owner_occupied_with_rent";

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
    { checklist_key: "IRS_PERSONAL_3Y", title: "Personal tax returns (3 years)", required: true },
    { checklist_key: "IRS_BUSINESS_3Y", title: "Business tax returns (3 years)", required: true },
    { checklist_key: "FIN_STMT_PL_YTD", title: "Income statement / Profit & Loss (YTD)", required: true },
    { checklist_key: "FIN_STMT_BS_YTD", title: "Balance sheet (current)", required: true },
    { checklist_key: "BANK_STMT_3M", title: "Bank statements (last 3 months)", required: false },
  ];

  // CRE checklist is sensitive to collateral type:
  // - Owner-occupied properties often do NOT have leases/rent roll/T12.
  // - Investor or partially rented properties DO.
  const CRE_COMMON: ChecklistSeedRow[] = [
    { checklist_key: "PROPERTY_INSURANCE", title: "Property insurance declarations page", required: true },
    { checklist_key: "REAL_ESTATE_TAX_BILL", title: "Real estate tax bill", required: false },
    { checklist_key: "APPRAISAL_IF_AVAILABLE", title: "Appraisal (if available)", required: false },
  ];

  const CRE_RENTAL_REQUIRED: ChecklistSeedRow[] = [
    { checklist_key: "RENT_ROLL", title: "Rent roll (current)", required: true },
    { checklist_key: "LEASES_TOP", title: "Major leases (top tenants)", required: true },
    { checklist_key: "PROPERTY_T12", title: "Trailing 12-month property operating statement", required: true },
  ];

  const CRE_RENTAL_OPTIONAL: ChecklistSeedRow[] = [
    { checklist_key: "RENT_ROLL", title: "Rent roll (if applicable)", required: false },
    { checklist_key: "LEASES_TOP", title: "Major leases (if applicable)", required: false },
    { checklist_key: "PROPERTY_T12", title: "Trailing 12-month property operating statement (if applicable)", required: false },
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

  const CRE_INVESTOR_SPECIFIC: ChecklistSeedRow[] = [
    { checklist_key: "OPERATING_AGREEMENT", title: "Operating agreement / entity docs", required: false },
    { checklist_key: "EXIT_STRATEGY", title: "Exit strategy / business plan", required: false },
  ];

  const CRE_OWNER_OCC_SPECIFIC: ChecklistSeedRow[] = [
    // Note: Business plans only required for SBA startups, not conventional loans with 2+ years history
    { checklist_key: "PROPERTY_USE_STATEMENT", title: "Property use statement / occupancy plan", required: false },
  ];

  const CRE_MIXED_USE_SPECIFIC: ChecklistSeedRow[] = [
    { checklist_key: "LEASE_SCHEDULE", title: "Schedule of leased vs occupied space", required: true },
    { checklist_key: "RENTAL_INCOME_PROJECTION", title: "Rental income projection (<49% space)", required: true },
  ];

  switch (loanType) {
    case "CRE":
    case "CRE_OWNER_OCCUPIED":
      return [...CORE, ...CRE_COMMON, ...CRE_RENTAL_OPTIONAL, ...CRE_OWNER_OCC_SPECIFIC];
    case "CRE_INVESTOR":
      return [...CORE, ...CRE_COMMON, ...CRE_RENTAL_REQUIRED, ...CRE_INVESTOR_SPECIFIC];
    case "CRE_OWNER_OCCUPIED_WITH_RENT":
      return [...CORE, ...CRE_COMMON, ...CRE_RENTAL_REQUIRED, ...CRE_OWNER_OCC_SPECIFIC, ...CRE_MIXED_USE_SPECIFIC];
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
