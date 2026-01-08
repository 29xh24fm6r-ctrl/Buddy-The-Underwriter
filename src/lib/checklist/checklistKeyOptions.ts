export type ChecklistKeyOption = {
  key: string;
  title: string;
};

// Client-safe shortlist of common checklist keys.
// Used for manual overrides when auto-match/auto-seed is not sufficient.
export const CHECKLIST_KEY_OPTIONS: ChecklistKeyOption[] = [
  { key: "PFS_CURRENT", title: "Personal Financial Statement (current)" },
  { key: "IRS_PERSONAL_2Y", title: "Personal tax returns" },
  { key: "IRS_BUSINESS_2Y", title: "Business tax returns" },
  { key: "FIN_STMT_YTD", title: "Year-to-date financial statement" },
  { key: "BANK_STMT_3M", title: "Bank statements (last 3 months)" },

  { key: "RENT_ROLL", title: "Rent roll (current)" },
  { key: "LEASES_TOP", title: "Major leases (top tenants)" },
  { key: "PROPERTY_T12", title: "Trailing 12-month property operating statement" },
  { key: "PROPERTY_INSURANCE", title: "Property insurance declarations page" },
  { key: "REAL_ESTATE_TAX_BILL", title: "Real estate tax bill" },
  { key: "APPRAISAL_IF_AVAILABLE", title: "Appraisal (if available)" },

  { key: "AR_AGING", title: "A/R aging" },
  { key: "AP_AGING", title: "A/P aging" },
  { key: "BORROWING_BASE_CERT", title: "Borrowing base certificate (most recent)" },
  { key: "INVENTORY_REPORT", title: "Inventory report (if applicable)" },

  { key: "DEBT_SCHEDULE", title: "Business debt schedule" },
  { key: "USES_OF_FUNDS", title: "Uses of funds / invoice support" },

  { key: "SBA_1919", title: "SBA Form 1919" },
  { key: "SBA_413", title: "SBA Form 413 (PFS)" },
  { key: "SBA_DEBT_SCHED", title: "Business debt schedule (SBA)" },
  { key: "SBA_912", title: "SBA Form 912 (if required)" },
  { key: "SBA_1244", title: "SBA Form 1244" },

  { key: "OPERATING_AGREEMENT", title: "Operating agreement / entity docs" },
  { key: "EXIT_STRATEGY", title: "Exit strategy / business plan" },
  { key: "PROPERTY_USE_STATEMENT", title: "Property use statement / occupancy plan" },
  { key: "LEASE_SCHEDULE", title: "Schedule of leased vs occupied space" },
  { key: "RENTAL_INCOME_PROJECTION", title: "Rental income projection" },
];
