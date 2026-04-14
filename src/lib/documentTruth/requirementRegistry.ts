// Pure. No DB. No side effects. No network.
// Single source of truth for all document requirements.

// ─── Types ────────────────────────────────────────────────────────────────────

export type RequirementCode =
  // Financial
  | "financials.business_tax_returns"
  | "financials.personal_tax_returns"
  | "financials.ytd_income_statement"
  | "financials.current_balance_sheet"
  | "financials.personal_financial_statement"
  // Collateral
  | "collateral.appraisal"
  // Liquidity
  | "liquidity.bank_statements"
  // Property (CRE)
  | "property.rent_roll"
  | "property.operating_statement"
  | "property.real_estate_tax_bill"
  | "property.insurance"
  | "property.occupancy_plan"
  // Legal
  | "legal.major_leases"
  // Loan Request
  | "loan_request.summary";

export type CanonicalDocType =
  | "business_tax_return"
  | "personal_tax_return"
  | "income_statement"
  | "ytd_income_statement"
  | "balance_sheet"
  | "current_balance_sheet"
  | "personal_financial_statement"
  | "bank_statement"
  | "appraisal"
  | "rent_roll"
  | "property_operating_statement"
  | "real_estate_tax_bill"
  | "insurance_declaration"
  | "occupancy_plan"
  | "major_lease"
  | "loan_request";

export type QuantityRule = "exact_count" | "minimum_count" | "any_one";
export type YearRule = "consecutive" | "most_recent" | "current";
export type SubjectRule = "per_guarantor" | "business" | "per_property" | "any";
export type DealType = "conventional" | "cre" | "sba_7a" | "sba_504" | "acquisition" | "all";

export type RequirementDefinition = {
  code: RequirementCode;
  label: string;
  group: string;
  required: boolean;
  dealTypes: DealType[];
  quantityRule: QuantityRule;
  requiredCount?: number;
  yearRule?: YearRule;
  yearCount?: number;
  subjectRule: SubjectRule;
  acceptedDocTypes: CanonicalDocType[];
  canBeWaived: boolean;
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const REQUIREMENT_REGISTRY: RequirementDefinition[] = [
  // Financial
  {
    code: "financials.business_tax_returns",
    label: "Business Tax Returns (3 consecutive years)",
    group: "financials",
    required: true,
    dealTypes: ["all"],
    quantityRule: "exact_count",
    requiredCount: 3,
    yearRule: "consecutive",
    yearCount: 3,
    subjectRule: "business",
    acceptedDocTypes: ["business_tax_return"],
    canBeWaived: false,
  },
  {
    code: "financials.personal_tax_returns",
    label: "Personal Tax Returns (3 consecutive years)",
    group: "financials",
    required: true,
    dealTypes: ["all"],
    quantityRule: "exact_count",
    requiredCount: 3,
    yearRule: "consecutive",
    yearCount: 3,
    subjectRule: "per_guarantor",
    acceptedDocTypes: ["personal_tax_return"],
    canBeWaived: false,
  },
  {
    code: "financials.ytd_income_statement",
    label: "YTD Income Statement",
    group: "financials",
    required: true,
    dealTypes: ["all"],
    quantityRule: "any_one",
    subjectRule: "business",
    acceptedDocTypes: ["income_statement", "ytd_income_statement"],
    canBeWaived: false,
  },
  {
    code: "financials.current_balance_sheet",
    label: "Current Balance Sheet",
    group: "financials",
    required: true,
    dealTypes: ["all"],
    quantityRule: "any_one",
    subjectRule: "business",
    acceptedDocTypes: ["balance_sheet", "current_balance_sheet"],
    canBeWaived: false,
  },
  {
    code: "financials.personal_financial_statement",
    label: "Personal Financial Statement",
    group: "financials",
    required: true,
    dealTypes: ["all"],
    quantityRule: "any_one",
    subjectRule: "per_guarantor",
    acceptedDocTypes: ["personal_financial_statement"],
    canBeWaived: true,
  },
  // Collateral
  {
    code: "collateral.appraisal",
    label: "Appraisal",
    group: "collateral",
    required: true,
    dealTypes: ["cre", "sba_7a", "sba_504"],
    quantityRule: "any_one",
    subjectRule: "per_property",
    acceptedDocTypes: ["appraisal"],
    canBeWaived: true,
  },
  // Liquidity
  {
    code: "liquidity.bank_statements",
    label: "Bank Statements (last 3 months)",
    group: "liquidity",
    required: false,      // Optional — banker judgment call, not a hard gate
    dealTypes: ["all"],
    quantityRule: "minimum_count",
    requiredCount: 3,
    subjectRule: "business",
    acceptedDocTypes: ["bank_statement"],
    canBeWaived: true,    // Can be waived when provided via other means
  },
  // Property
  {
    code: "property.rent_roll",
    label: "Rent Roll",
    group: "property",
    required: true,
    dealTypes: ["cre"],
    quantityRule: "any_one",
    subjectRule: "per_property",
    acceptedDocTypes: ["rent_roll"],
    canBeWaived: false,
  },
  {
    code: "property.operating_statement",
    label: "Operating Statement (T12)",
    group: "property",
    required: true,
    dealTypes: ["cre"],
    quantityRule: "any_one",
    subjectRule: "per_property",
    acceptedDocTypes: ["property_operating_statement"],
    canBeWaived: false,
  },
  {
    code: "property.real_estate_tax_bill",
    label: "Real Estate Tax Bill",
    group: "property",
    required: false,
    dealTypes: ["cre"],
    quantityRule: "any_one",
    subjectRule: "per_property",
    acceptedDocTypes: ["real_estate_tax_bill"],
    canBeWaived: true,
  },
  {
    code: "property.insurance",
    label: "Property Insurance",
    group: "property",
    required: false,
    dealTypes: ["cre"],
    quantityRule: "any_one",
    subjectRule: "per_property",
    acceptedDocTypes: ["insurance_declaration"],
    canBeWaived: true,
  },
  {
    code: "property.occupancy_plan",
    label: "Occupancy Plan",
    group: "property",
    required: false,
    dealTypes: ["cre"],
    quantityRule: "any_one",
    subjectRule: "per_property",
    acceptedDocTypes: ["occupancy_plan"],
    canBeWaived: true,
  },
  // Legal
  {
    code: "legal.major_leases",
    label: "Major Leases",
    group: "legal",
    required: false,
    dealTypes: ["cre"],
    quantityRule: "minimum_count",
    requiredCount: 1,
    subjectRule: "per_property",
    acceptedDocTypes: ["major_lease"],
    canBeWaived: true,
  },
  // Loan Request
  {
    code: "loan_request.summary",
    label: "Loan Request",
    group: "loan_request",
    required: false,
    dealTypes: ["all"],
    quantityRule: "any_one",
    subjectRule: "any",
    acceptedDocTypes: ["loan_request"],
    canBeWaived: true,
  },
];

const registryMap = new Map<string, RequirementDefinition>();
for (const def of REQUIREMENT_REGISTRY) {
  registryMap.set(def.code, def);
}

export function lookupRequirement(code: string): RequirementDefinition | undefined {
  return registryMap.get(code);
}

export function getRequirementsForDealType(dealType: string): RequirementDefinition[] {
  return REQUIREMENT_REGISTRY.filter(
    (r) => r.dealTypes.includes("all") || r.dealTypes.includes(dealType as DealType),
  );
}

export function getRequirementsForDealMode(
  dealType: string,
  dealMode: string | null | undefined,
): RequirementDefinition[] {
  const base = getRequirementsForDealType(dealType);
  if (dealMode !== "quick_look") return base;

  return base.map((r) => {
    if (
      r.code === "financials.personal_tax_returns" ||
      r.code === "financials.personal_financial_statement"
    ) {
      return { ...r, required: false };
    }
    if (r.code === "financials.business_tax_returns") {
      return { ...r, requiredCount: 2, yearCount: 2, label: "Business Tax Returns (2 years — Quick Look)" };
    }
    return r;
  });
}
