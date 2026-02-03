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

/**
 * Calculate the 3 most recent tax years based on filing season.
 * Before April 16: most recent filed year is 2 years back (e.g., Jan 2026 → 2024, 2023, 2022)
 * After April 16: most recent filed year is 1 year back (e.g., May 2026 → 2025, 2024, 2023)
 */
function getTaxYears(): [number, number, number] {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth(); // 0=Jan
  const utcDay = now.getUTCDate();
  const beforeFilingDeadline = utcMonth < 3 || (utcMonth === 3 && utcDay < 16); // before Apr 16
  const mostRecentYear = beforeFilingDeadline ? currentYear - 2 : currentYear - 1;
  return [mostRecentYear, mostRecentYear - 1, mostRecentYear - 2];
}

export function buildChecklistForLoanType(loanType: LoanType): ChecklistSeedRow[] {
  // Deterministic. No LLM. Bulletproof defaults.
  const [year1, year2, year3] = getTaxYears();

  // Core required documents - individual tax year items for better tracking
  const CORE: ChecklistSeedRow[] = [
    { checklist_key: "PFS_CURRENT", title: "Personal Financial Statement (current)", required: true },
    // Personal tax returns - individual years
    { checklist_key: `IRS_PERSONAL_${year1}`, title: `${year1} Personal Tax Return`, required: true },
    { checklist_key: `IRS_PERSONAL_${year2}`, title: `${year2} Personal Tax Return`, required: true },
    { checklist_key: `IRS_PERSONAL_${year3}`, title: `${year3} Personal Tax Return`, required: true },
    // Business tax returns - individual years
    { checklist_key: `IRS_BUSINESS_${year1}`, title: `${year1} Business Tax Return`, required: true },
    { checklist_key: `IRS_BUSINESS_${year2}`, title: `${year2} Business Tax Return`, required: true },
    { checklist_key: `IRS_BUSINESS_${year3}`, title: `${year3} Business Tax Return`, required: true },
    // Financial statements
    { checklist_key: "FIN_STMT_PL_YTD", title: "Income statement / Profit & Loss (YTD)", required: true },
    { checklist_key: "FIN_STMT_BS_YTD", title: "Balance sheet (current)", required: true },
    { checklist_key: "BANK_STMT_3M", title: "Bank statements (last 3 months)", required: false },
  ];

  // CRE checklist - all items OPTIONAL for non-SBA deals
  // User requirement: only CORE docs (tax returns, financials, PFS) are required
  const CRE_COMMON: ChecklistSeedRow[] = [
    { checklist_key: "PROPERTY_INSURANCE", title: "Property insurance declarations page", required: false },
    { checklist_key: "REAL_ESTATE_TAX_BILL", title: "Real estate tax bill", required: false },
    { checklist_key: "APPRAISAL_IF_AVAILABLE", title: "Appraisal (if available)", required: false },
  ];

  const CRE_RENTAL_OPTIONAL: ChecklistSeedRow[] = [
    { checklist_key: "RENT_ROLL", title: "Rent roll (if applicable)", required: false },
    { checklist_key: "LEASES_TOP", title: "Major leases (if applicable)", required: false },
    { checklist_key: "PROPERTY_T12", title: "Trailing 12-month property operating statement (if applicable)", required: false },
  ];

  const LOC: ChecklistSeedRow[] = [
    { checklist_key: "AR_AGING", title: "A/R aging (if applicable)", required: false },
    { checklist_key: "AP_AGING", title: "A/P aging (if applicable)", required: false },
    { checklist_key: "BORROWING_BASE_CERT", title: "Borrowing base certificate (if applicable)", required: false },
    { checklist_key: "INVENTORY_REPORT", title: "Inventory report (if applicable)", required: false },
  ];

  const TERM: ChecklistSeedRow[] = [
    { checklist_key: "DEBT_SCHEDULE", title: "Business debt schedule (if applicable)", required: false },
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
    { checklist_key: "LEASE_SCHEDULE", title: "Schedule of leased vs occupied space (if applicable)", required: false },
    { checklist_key: "RENTAL_INCOME_PROJECTION", title: "Rental income projection (<49% space)", required: false },
  ];

  switch (loanType) {
    case "CRE":
    case "CRE_OWNER_OCCUPIED":
      return [...CORE, ...CRE_COMMON, ...CRE_RENTAL_OPTIONAL, ...CRE_OWNER_OCC_SPECIFIC];
    case "CRE_INVESTOR":
      return [...CORE, ...CRE_COMMON, ...CRE_RENTAL_OPTIONAL, ...CRE_INVESTOR_SPECIFIC];
    case "CRE_OWNER_OCCUPIED_WITH_RENT":
      return [...CORE, ...CRE_COMMON, ...CRE_RENTAL_OPTIONAL, ...CRE_OWNER_OCC_SPECIFIC, ...CRE_MIXED_USE_SPECIFIC];
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
