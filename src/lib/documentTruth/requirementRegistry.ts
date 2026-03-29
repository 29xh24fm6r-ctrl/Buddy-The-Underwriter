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
  | "legal.major_leases";

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
  },
  {
    code: "financials.ytd_income_statement",
    label: "YTD Income Statement",
    group: "financials",
    required: true,
    dealTypes: ["all"],
    quantityRule: "any_one",
    subjectRule: "business",
  },
  {
    code: "financials.current_balance_sheet",
    label: "Current Balance Sheet",
    group: "financials",
    required: true,
    dealTypes: ["all"],
    quantityRule: "any_one",
    subjectRule: "business",
  },
  {
    code: "financials.personal_financial_statement",
    label: "Personal Financial Statement",
    group: "financials",
    required: true,
    dealTypes: ["all"],
    quantityRule: "any_one",
    subjectRule: "per_guarantor",
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
  },
  // Liquidity
  {
    code: "liquidity.bank_statements",
    label: "Bank Statements (last 3 months)",
    group: "liquidity",
    required: true,
    dealTypes: ["all"],
    quantityRule: "minimum_count",
    requiredCount: 3,
    subjectRule: "business",
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
  },
  {
    code: "property.operating_statement",
    label: "Operating Statement (T12)",
    group: "property",
    required: true,
    dealTypes: ["cre"],
    quantityRule: "any_one",
    subjectRule: "per_property",
  },
  {
    code: "property.real_estate_tax_bill",
    label: "Real Estate Tax Bill",
    group: "property",
    required: false,
    dealTypes: ["cre"],
    quantityRule: "any_one",
    subjectRule: "per_property",
  },
  {
    code: "property.insurance",
    label: "Property Insurance",
    group: "property",
    required: false,
    dealTypes: ["cre"],
    quantityRule: "any_one",
    subjectRule: "per_property",
  },
  {
    code: "property.occupancy_plan",
    label: "Occupancy Plan",
    group: "property",
    required: false,
    dealTypes: ["cre"],
    quantityRule: "any_one",
    subjectRule: "per_property",
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
