// src/lib/interview/factKeys.ts

/**
 * Allowed fact keys for interview sessions.
 * This is the single source of truth for what facts Buddy can collect.
 * 
 * Auditor note: All facts must use one of these keys to ensure consistent
 * reporting and compliance tracking.
 */
export type AllowedFactKey =
  // Loan basics
  | "loan_type_requested"
  | "requested_amount"
  | "loan_purpose"
  | "use_of_proceeds"
  | "project_cost_total"

  // Business identity
  | "legal_business_name"
  | "dba_name"
  | "entity_type"
  | "business_address"
  | "business_start_date"
  | "ein"
  | "industry"
  | "naics_code"

  // Contact
  | "best_contact_name"
  | "best_contact_phone"
  | "best_contact_email"

  // Ownership
  | "owners"
  | "primary_owner_name"
  | "primary_owner_percent"
  | "owner_guarantors"

  // Financials
  | "annual_revenue"
  | "net_income"
  | "cash_on_hand"
  | "existing_debt_summary"

  // SBA specific
  | "sba_ineligible_business_flags"
  | "sba_affiliation_flags"
  | "sba_size_standard_met"

  // CRE specific
  | "real_estate_address"
  | "purchase_price"
  | "appraised_value"
  | "down_payment_amount"
  | "down_payment_source"

  // Equipment specific
  | "equipment_description"
  | "equipment_vendor"
  | "equipment_quote_amount"

  // Other
  | "collateral_description"
  | "guarantor_names"
  | "bankruptcy_history"
  | "criminal_history"
  | "citizen_or_permanent_resident"
  | "veteran_owned"
  | "woman_owned"
  | "minority_owned";

/**
 * Array of all allowed fact keys.
 * Used for OpenAI structured output enum validation.
 */
export const ALLOWED_FACT_KEYS: AllowedFactKey[] = [
  "loan_type_requested",
  "requested_amount",
  "loan_purpose",
  "use_of_proceeds",
  "project_cost_total",
  "legal_business_name",
  "dba_name",
  "entity_type",
  "business_address",
  "business_start_date",
  "ein",
  "industry",
  "naics_code",
  "best_contact_name",
  "best_contact_phone",
  "best_contact_email",
  "owners",
  "primary_owner_name",
  "primary_owner_percent",
  "owner_guarantors",
  "annual_revenue",
  "net_income",
  "cash_on_hand",
  "existing_debt_summary",
  "sba_ineligible_business_flags",
  "sba_affiliation_flags",
  "sba_size_standard_met",
  "real_estate_address",
  "purchase_price",
  "appraised_value",
  "down_payment_amount",
  "down_payment_source",
  "equipment_description",
  "equipment_vendor",
  "equipment_quote_amount",
  "collateral_description",
  "guarantor_names",
  "bankruptcy_history",
  "criminal_history",
  "citizen_or_permanent_resident",
  "veteran_owned",
  "woman_owned",
  "minority_owned",
];

/**
 * Human-readable labels for fact keys.
 * Used for UI display and error messages.
 */
export const FACT_KEY_LABELS: Record<AllowedFactKey, string> = {
  loan_type_requested: "Loan Type",
  requested_amount: "Requested Amount",
  loan_purpose: "Loan Purpose",
  use_of_proceeds: "Use of Proceeds",
  project_cost_total: "Total Project Cost",

  legal_business_name: "Legal Business Name",
  dba_name: "DBA Name",
  entity_type: "Entity Type",
  business_address: "Business Address",
  business_start_date: "Business Start Date",
  ein: "EIN",
  industry: "Industry",
  naics_code: "NAICS Code",

  best_contact_name: "Contact Name",
  best_contact_phone: "Contact Phone",
  best_contact_email: "Contact Email",

  owners: "Owners",
  primary_owner_name: "Primary Owner Name",
  primary_owner_percent: "Primary Owner %",
  owner_guarantors: "Owner Guarantors",

  annual_revenue: "Annual Revenue",
  net_income: "Net Income",
  cash_on_hand: "Cash on Hand",
  existing_debt_summary: "Existing Debt",

  sba_ineligible_business_flags: "SBA Ineligibility Check",
  sba_affiliation_flags: "SBA Affiliation Check",
  sba_size_standard_met: "SBA Size Standard Met",

  real_estate_address: "Property Address",
  purchase_price: "Purchase Price",
  appraised_value: "Appraised Value",
  down_payment_amount: "Down Payment",
  down_payment_source: "Down Payment Source",

  equipment_description: "Equipment Description",
  equipment_vendor: "Equipment Vendor",
  equipment_quote_amount: "Equipment Quote Amount",

  collateral_description: "Collateral Description",
  guarantor_names: "Guarantor Names",
  bankruptcy_history: "Bankruptcy History",
  criminal_history: "Criminal History",
  citizen_or_permanent_resident: "Citizenship/Permanent Resident",
  veteran_owned: "Veteran Owned",
  woman_owned: "Woman Owned",
  minority_owned: "Minority Owned",
};
