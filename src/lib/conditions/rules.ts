export type LoanProductType = "CRE" | "LOC" | "TERM" | "SBA_7A" | "SBA_504" | "SBA_EXPRESS";

export type ExpectedDocKey =
  | "PFS_CURRENT"
  | "IRS_BUSINESS_TAX_RETURN_1"
  | "IRS_BUSINESS_TAX_RETURN_2"
  | "IRS_BUSINESS_TAX_RETURN_3"
  | "IRS_PERSONAL_TAX_RETURN_1"
  | "IRS_PERSONAL_TAX_RETURN_2"
  | "IRS_PERSONAL_TAX_RETURN_3"
  | "YTD_FINANCIALS"
  | "BANK_STATEMENTS_3MO"
  | "AR_AGING"
  | "AP_AGING"
  | "RENT_ROLL"
  | "LEASES"
  | "SBA_FORM_1919"
  | "SBA_FORM_413"
  | "SBA_FORM_912";

export type ExpectedDoc = {
  key: ExpectedDocKey;
  label: string;
  severity: "high" | "medium" | "low";
  appliesWhen: (ctx: {
    product: LoanProductType;
    hasRealEstateCollateral: boolean;
    isSba: boolean;
  }) => boolean;
};

export const EXPECTED_DOCS: ExpectedDoc[] = [
  { key: "PFS_CURRENT", label: "Personal Financial Statement (current)", severity: "high", appliesWhen: () => true },
  { key: "YTD_FINANCIALS", label: "Year-to-date financials (P&L + Balance Sheet)", severity: "high", appliesWhen: () => true },
  { key: "BANK_STATEMENTS_3MO", label: "Business bank statements (last 3 months)", severity: "medium", appliesWhen: () => true },

  { key: "IRS_BUSINESS_TAX_RETURN_1", label: "Business tax return (most recent year)", severity: "high", appliesWhen: () => true },
  { key: "IRS_BUSINESS_TAX_RETURN_2", label: "Business tax return (prior year)", severity: "high", appliesWhen: () => true },
  { key: "IRS_BUSINESS_TAX_RETURN_3", label: "Business tax return (2 years prior)", severity: "medium", appliesWhen: () => true },

  { key: "IRS_PERSONAL_TAX_RETURN_1", label: "Personal tax return (most recent year)", severity: "high", appliesWhen: () => true },
  { key: "IRS_PERSONAL_TAX_RETURN_2", label: "Personal tax return (prior year)", severity: "medium", appliesWhen: () => true },
  { key: "IRS_PERSONAL_TAX_RETURN_3", label: "Personal tax return (2 years prior)", severity: "low", appliesWhen: () => true },

  { key: "AR_AGING", label: "Accounts receivable aging", severity: "low", appliesWhen: () => true },
  { key: "AP_AGING", label: "Accounts payable aging", severity: "low", appliesWhen: () => true },

  { key: "RENT_ROLL", label: "Rent roll", severity: "high", appliesWhen: (c) => c.hasRealEstateCollateral || c.product === "CRE" },
  { key: "LEASES", label: "Leases (major tenants)", severity: "medium", appliesWhen: (c) => c.hasRealEstateCollateral || c.product === "CRE" },

  // SBA package docs
  { key: "SBA_FORM_1919", label: "SBA Form 1919", severity: "high", appliesWhen: (c) => c.isSba },
  { key: "SBA_FORM_413", label: "SBA Form 413 (PFS)", severity: "high", appliesWhen: (c) => c.isSba },
  { key: "SBA_FORM_912", label: "SBA Form 912 (Statement of Personal History)", severity: "medium", appliesWhen: (c) => c.isSba },
];

export type ConditionRule = {
  code: string;
  title: string;
  severity: "high" | "medium" | "low";
  // condition is "open" if predicate returns true
  predicate: (ctx: {
    missingKeys: Set<string>;
    product: LoanProductType;
    isSba: boolean;
    hasRealEstateCollateral: boolean;
  }) => { open: boolean; evidence: { kind: string; label: string; detail?: string }[] };
};

export const CONDITION_RULES: ConditionRule[] = [
  {
    code: "COND_MISSING_PFS",
    title: "Obtain current Personal Financial Statement",
    severity: "high",
    predicate: ({ missingKeys }) => ({
      open: missingKeys.has("PFS_CURRENT"),
      evidence: missingKeys.has("PFS_CURRENT")
        ? [{ kind: "doc_missing", label: "Missing: PFS (current)", detail: "Required for global cash flow and guarantor analysis." }]
        : [{ kind: "doc_present", label: "PFS present" }],
    }),
  },
  {
    code: "COND_MISSING_TAX_RETURNS",
    title: "Obtain required tax returns",
    severity: "high",
    predicate: ({ missingKeys }) => {
      const keys = ["IRS_BUSINESS_TAX_RETURN_1", "IRS_BUSINESS_TAX_RETURN_2", "IRS_PERSONAL_TAX_RETURN_1"];
      const open = keys.some((k) => missingKeys.has(k));
      const evidence = open
        ? keys.filter((k) => missingKeys.has(k)).map((k) => ({ kind: "doc_missing", label: `Missing: ${k}` }))
        : [{ kind: "doc_present", label: "Tax returns present" }];
      return { open, evidence };
    },
  },
  {
    code: "COND_MISSING_RENT_ROLL",
    title: "Obtain rent roll / leases for collateral",
    severity: "high",
    predicate: ({ missingKeys, hasRealEstateCollateral, product }) => {
      const applies = hasRealEstateCollateral || product === "CRE";
      const open = applies && missingKeys.has("RENT_ROLL");
      const evidence = applies
        ? open
          ? [{ kind: "doc_missing", label: "Missing: Rent roll", detail: "Required for CRE underwriting and DSCR validation." }]
          : [{ kind: "doc_present", label: "Rent roll present" }]
        : [{ kind: "system", label: "Not applicable (no CRE collateral)" }];
      return { open, evidence };
    },
  },
  {
    code: "COND_SBA_FORMS",
    title: "Complete SBA required forms",
    severity: "high",
    predicate: ({ missingKeys, isSba }) => {
      const keys = ["SBA_FORM_1919", "SBA_FORM_413", "SBA_FORM_912"];
      const open = isSba && keys.some((k) => missingKeys.has(k));
      const evidence = !isSba
        ? [{ kind: "system", label: "Not applicable (non-SBA product)" }]
        : open
          ? keys.filter((k) => missingKeys.has(k)).map((k) => ({ kind: "doc_missing", label: `Missing: ${k}` }))
          : [{ kind: "doc_present", label: "SBA forms present" }];
      return { open, evidence };
    },
  },
];
