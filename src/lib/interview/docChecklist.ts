// src/lib/interview/docChecklist.ts

export type LoanTypeNormalized =
  | "sba_7a"
  | "sba_504"
  | "cre"
  | "loc"
  | "term"
  | "equipment"
  | "unknown";

export type ChecklistDocItem = {
  key: string;
  label: string;
  required: boolean;
  notes?: string;
};

export type ChecklistFactKey = {
  key: string;
  label: string;
  required: boolean;
};

export type ChecklistRule = {
  loanType: LoanTypeNormalized;
  title: string;
  factKeys: ChecklistFactKey[];
  docs: ChecklistDocItem[];
};

export function normalizeLoanType(v: any): LoanTypeNormalized {
  const s = String(v || "").toLowerCase();
  if (s.includes("7") || s.includes("7(a") || s.includes("7a")) return "sba_7a";
  if (s.includes("504")) return "sba_504";
  if (s.includes("real estate") || s.includes("cre") || s.includes("property")) return "cre";
  if (s.includes("line") || s.includes("loc")) return "loc";
  if (s.includes("equipment")) return "equipment";
  if (s.includes("term")) return "term";
  return "unknown";
}

const COMMON_FACTS: ChecklistFactKey[] = [
  { key: "loan_type_requested", label: "Loan type requested", required: true },
  { key: "requested_amount", label: "Requested amount", required: true },
  { key: "use_of_proceeds", label: "Use of proceeds", required: true },
  { key: "business_name", label: "Business name", required: true },
  { key: "entity_type", label: "Entity type (LLC/S-Corp/etc.)", required: false },
  { key: "years_in_business", label: "Years in business", required: false },
  { key: "ownership_breakdown", label: "Ownership breakdown", required: false },
];

const COMMON_DOCS: ChecklistDocItem[] = [
  { key: "biz_tax_returns", label: "Business tax returns (most recent years)", required: true },
  { key: "personal_tax_returns", label: "Personal tax returns for guarantors", required: true },
  { key: "interim_financials", label: "Interim financials (P&L + Balance Sheet)", required: true },
  { key: "debt_schedule", label: "Business debt schedule", required: true },
];

export function getChecklistRule(loanType: LoanTypeNormalized): ChecklistRule {
  if (loanType === "sba_7a") {
    return {
      loanType,
      title: "Checklist — SBA 7(a)",
      factKeys: [
        ...COMMON_FACTS,
        { key: "sba_loan_purpose", label: "SBA purpose (working capital/acquisition/etc.)", required: false },
        { key: "guarantors", label: "Guarantors (names + ownership)", required: true },
      ],
      docs: [
        ...COMMON_DOCS,
        { key: "sba_forms", label: "SBA forms & disclosures (program-required)", required: true },
        { key: "id_docs", label: "Government ID for principals", required: true },
        { key: "bank_statements", label: "Bank statements (if requested)", required: false },
      ],
    };
  }

  if (loanType === "sba_504") {
    return {
      loanType,
      title: "Checklist — SBA 504",
      factKeys: [
        ...COMMON_FACTS,
        { key: "project_type", label: "Project type (CRE/equipment)", required: true },
        { key: "project_cost", label: "Total project cost", required: true },
        { key: "owner_occupancy", label: "Owner occupancy details (if CRE)", required: false },
      ],
      docs: [
        ...COMMON_DOCS,
        { key: "project_sources_uses", label: "Project sources & uses", required: true },
        { key: "purchase_contract_or_budget", label: "Purchase contract or construction budget", required: true },
        { key: "property_details", label: "Property details (if CRE)", required: false },
      ],
    };
  }

  if (loanType === "cre") {
    return {
      loanType,
      title: "Checklist — Commercial Real Estate",
      factKeys: [
        ...COMMON_FACTS,
        { key: "property_address", label: "Property address", required: true },
        { key: "purchase_price", label: "Purchase price (or current value)", required: true },
        { key: "down_payment", label: "Down payment / equity injection", required: false },
        { key: "occupancy_type", label: "Owner-occupied vs investment", required: true },
      ],
      docs: [
        ...COMMON_DOCS,
        { key: "purchase_contract_or_payoff", label: "Purchase contract or payoff statement", required: true },
        { key: "rent_roll", label: "Rent roll (if applicable)", required: false },
        { key: "leases", label: "Leases (if applicable)", required: false },
        { key: "insurance", label: "Insurance declarations (if available)", required: false },
      ],
    };
  }

  if (loanType === "loc") {
    return {
      loanType,
      title: "Checklist — Line of Credit",
      factKeys: [
        ...COMMON_FACTS,
        { key: "working_capital_need", label: "Working capital need / operating cycle", required: false },
        { key: "collateral_type", label: "Collateral type (if secured)", required: false },
      ],
      docs: [
        ...COMMON_DOCS,
        { key: "ar_aging", label: "A/R aging (if applicable)", required: false },
        { key: "inventory_report", label: "Inventory report (if applicable)", required: false },
        { key: "bank_statements", label: "Recent bank statements (if requested)", required: false },
      ],
    };
  }

  if (loanType === "equipment") {
    return {
      loanType,
      title: "Checklist — Equipment Financing",
      factKeys: [
        ...COMMON_FACTS,
        { key: "equipment_type", label: "Equipment type", required: true },
        { key: "equipment_cost", label: "Equipment cost", required: true },
        { key: "vendor_name", label: "Vendor name", required: false },
      ],
      docs: [
        ...COMMON_DOCS,
        { key: "equipment_quote", label: "Equipment quote / invoice", required: true },
        { key: "vendor_w9", label: "Vendor W-9 (if requested)", required: false },
      ],
    };
  }

  if (loanType === "term") {
    return {
      loanType,
      title: "Checklist — Term Loan",
      factKeys: [...COMMON_FACTS],
      docs: [...COMMON_DOCS],
    };
  }

  return {
    loanType: "unknown",
    title: "Checklist — Business Lending",
    factKeys: [...COMMON_FACTS],
    docs: [...COMMON_DOCS],
  };
}

export function computeMissingFactKeys(confirmedFactKeys: Set<string>, rule: ChecklistRule) {
  return rule.factKeys
    .filter((k) => k.required)
    .filter((k) => !confirmedFactKeys.has(k.key))
    .map((k) => k.key);
}
