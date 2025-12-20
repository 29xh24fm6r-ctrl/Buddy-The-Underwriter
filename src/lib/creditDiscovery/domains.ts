// src/lib/creditDiscovery/domains.ts
export type DiscoveryDomain =
  | "identity"
  | "ownership"
  | "management"
  | "business_model"
  | "financials"
  | "loan_request"
  | "repayment"
  | "risk";

export const DOMAIN_REQUIREMENTS: Record<DiscoveryDomain, { label: string; requiredKeys: string[] }> = {
  identity: {
    label: "Borrower identity & structure",
    requiredKeys: ["legal_name", "ein", "entity_type", "state_of_formation", "operating_entity_desc"],
  },
  ownership: {
    label: "Ownership & control",
    requiredKeys: ["ownership_structure_summary"],
  },
  management: {
    label: "Management & experience",
    requiredKeys: ["primary_operator", "years_in_business", "industry_experience_summary"],
  },
  business_model: {
    label: "Business model",
    requiredKeys: ["what_you_sell", "who_buys", "top_customers_summary", "seasonality_summary"],
  },
  financials: {
    label: "Financial reality",
    requiredKeys: ["revenue_trend_summary", "profitability_trend_summary", "debt_summary"],
  },
  loan_request: {
    label: "Loan request",
    requiredKeys: ["loan_amount", "use_of_proceeds_line_items", "timing_need"],
  },
  repayment: {
    label: "Repayment & support",
    requiredKeys: ["primary_repayment_source", "secondary_repayment_source", "collateral_offered_summary"],
  },
  risk: {
    label: "Risk signals",
    requiredKeys: ["key_risks", "mitigants"],
  },
};

export const DISCOVERY_STAGE_FLOW: Array<{ stage: string; domains: DiscoveryDomain[] }> = [
  { stage: "business", domains: ["identity", "management", "business_model"] },
  { stage: "ownership", domains: ["ownership"] },
  { stage: "loan", domains: ["loan_request"] },
  { stage: "repayment", domains: ["financials", "repayment"] },
  { stage: "risk", domains: ["risk"] },
  { stage: "wrapup", domains: [] },
];
