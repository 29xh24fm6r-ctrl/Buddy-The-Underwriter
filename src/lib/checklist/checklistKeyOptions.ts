export type ChecklistKeyOption = {
  key: string;
  title: string;
  category: "tax" | "financial" | "property" | "entity" | "sba" | "other";
  docType?: string;
  /** True for year-based checklist items that require tax_year on matched docs */
  requiresTaxYear?: boolean;
};

export const CHECKLIST_KEY_OPTIONS: ChecklistKeyOption[] = [
  // Tax Documents
  { key: "IRS_PERSONAL_3Y", title: "Personal Tax Returns (3 consecutive years)", category: "tax", docType: "PERSONAL_TAX_RETURN", requiresTaxYear: true },
  { key: "IRS_PERSONAL_2Y", title: "Personal Tax Returns (2 years)", category: "tax", docType: "PERSONAL_TAX_RETURN", requiresTaxYear: true },
  { key: "IRS_BUSINESS_3Y", title: "Business Tax Returns (3 consecutive years)", category: "tax", docType: "BUSINESS_TAX_RETURN", requiresTaxYear: true },
  { key: "IRS_BUSINESS_2Y", title: "Business Tax Returns (2 years)", category: "tax", docType: "BUSINESS_TAX_RETURN", requiresTaxYear: true },
  { key: "K1", title: "Schedule K-1", category: "tax", docType: "K1" },
  { key: "W2", title: "W-2 Wage Statement", category: "tax", docType: "W2" },
  { key: "1099", title: "1099 Form", category: "tax", docType: "1099" },

  // Financial Statements
  { key: "PFS_CURRENT", title: "Personal Financial Statement (current)", category: "financial", docType: "PFS" },
  { key: "FIN_STMT_PL_YTD", title: "Income Statement / P&L (YTD)", category: "financial", docType: "INCOME_STATEMENT" },
  { key: "FIN_STMT_BS_YTD", title: "Balance Sheet (current)", category: "financial", docType: "BALANCE_SHEET" },
  { key: "BANK_STMT_3M", title: "Bank Statements (3 months)", category: "financial", docType: "BANK_STATEMENT" },
  { key: "AR_AGING", title: "A/R Aging Report", category: "financial", docType: "AR_AGING" },
  { key: "AP_AGING", title: "A/P Aging Report", category: "financial", docType: "AP_AGING" },
  { key: "DEBT_SCHEDULE", title: "Business Debt Schedule", category: "financial", docType: "DEBT_SCHEDULE" },
  { key: "BORROWING_BASE_CERT", title: "Borrowing Base Certificate", category: "financial", docType: "BORROWING_BASE" },
  { key: "INVENTORY_REPORT", title: "Inventory Report", category: "financial", docType: "INVENTORY" },
  { key: "USES_OF_FUNDS", title: "Uses of Funds / Invoice Support", category: "financial", docType: "USES_OF_FUNDS" },

  // Property Documents
  { key: "RENT_ROLL", title: "Rent Roll (current)", category: "property", docType: "RENT_ROLL" },
  { key: "PROPERTY_T12", title: "T12 / Operating Statement", category: "property", docType: "T12" },
  { key: "LEASES_TOP", title: "Major Leases (top tenants)", category: "property", docType: "LEASE" },
  { key: "PROPERTY_INSURANCE", title: "Property Insurance", category: "property", docType: "INSURANCE" },
  { key: "REAL_ESTATE_TAX_BILL", title: "Real Estate Tax Bill", category: "property", docType: "TAX_BILL" },
  { key: "APPRAISAL_IF_AVAILABLE", title: "Appraisal", category: "property", docType: "APPRAISAL" },
  { key: "ENVIRONMENTAL", title: "Environmental Report (Phase I/II)", category: "property", docType: "ENVIRONMENTAL" },
  { key: "SCHEDULE_OF_RE", title: "Schedule of Real Estate", category: "property", docType: "SCHEDULE_OF_RE" },

  // Entity / Legal Documents
  { key: "OPERATING_AGREEMENT", title: "Operating Agreement", category: "entity", docType: "OPERATING_AGREEMENT" },
  { key: "ARTICLES", title: "Articles of Incorporation/Organization", category: "entity", docType: "ARTICLES" },
  { key: "BYLAWS", title: "Corporate Bylaws", category: "entity", docType: "BYLAWS" },
  { key: "BUSINESS_LICENSE", title: "Business License", category: "entity", docType: "BUSINESS_LICENSE" },
  { key: "DRIVERS_LICENSE", title: "Driver's License / ID", category: "entity", docType: "DRIVERS_LICENSE" },
  { key: "EXIT_STRATEGY", title: "Exit Strategy / Business Plan", category: "entity", docType: "BUSINESS_PLAN" },

  // SBA-Specific Forms
  { key: "SBA_1919", title: "SBA Form 1919 (Borrower Info)", category: "sba", docType: "SBA_FORM" },
  { key: "SBA_413", title: "SBA Form 413 (PFS)", category: "sba", docType: "PFS" },
  { key: "SBA_DEBT_SCHED", title: "SBA Debt Schedule", category: "sba", docType: "DEBT_SCHEDULE" },
  { key: "SBA_912", title: "SBA Form 912", category: "sba", docType: "SBA_FORM" },
  { key: "SBA_1244", title: "SBA Form 1244", category: "sba", docType: "SBA_FORM" },

  // Other
  { key: "OTHER", title: "Other Document", category: "other", docType: "OTHER" },
];

export const CATEGORY_LABELS: Record<string, string> = {
  tax: "Tax Documents",
  financial: "Financial Statements",
  property: "Property Documents",
  entity: "Entity / Legal",
  sba: "SBA Forms",
  other: "Other",
};

/** Merge seeded options with master list (seeded first, then remaining). */
export function mergeWithSeededOptions(
  seededOptions: Array<{ key: string; title: string }>,
): ChecklistKeyOption[] {
  const seen = new Set<string>();
  const result: ChecklistKeyOption[] = [];

  for (const opt of seededOptions) {
    if (!seen.has(opt.key)) {
      seen.add(opt.key);
      const master = CHECKLIST_KEY_OPTIONS.find((o) => o.key === opt.key);
      result.push(master || { key: opt.key, title: opt.title, category: "other" });
    }
  }

  for (const opt of CHECKLIST_KEY_OPTIONS) {
    if (!seen.has(opt.key)) {
      seen.add(opt.key);
      result.push(opt);
    }
  }

  return result;
}

/** Checklist keys that require a tax year for year-based satisfaction */
export const YEAR_REQUIRED_KEYS = new Set(
  CHECKLIST_KEY_OPTIONS
    .filter((o) => o.requiresTaxYear)
    .map((o) => o.key),
);

/** Whether this checklist key requires a tax year value on matched documents */
export function isTaxYearRequired(key: string | null | undefined): boolean {
  if (!key) return false;
  return YEAR_REQUIRED_KEYS.has(key);
}
