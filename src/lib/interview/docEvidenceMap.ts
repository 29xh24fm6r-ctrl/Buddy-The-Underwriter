// src/lib/interview/docEvidenceMap.ts

/**
 * Maps checklist "doc keys" to likely classifier doc types.
 * Adjust this list to match your classifier outputs.
 *
 * The system remains regulator-proof: it only uses this mapping to show UI status
 * (uploaded / processing / classified). Underwriting decisions still rely on verified docs.
 */

export type ClassifierDocType =
  | "IRS_1040"
  | "IRS_1065"
  | "IRS_1120"
  | "IRS_1120S"
  | "K1"
  | "PFS"
  | "BANK_STATEMENT"
  | "LEASE"
  | "FINANCIAL_STATEMENT"
  | "INVOICE"
  | "UNKNOWN"
  | string;

export const DOC_KEY_TO_TYPES: Record<string, ClassifierDocType[]> = {
  // Core financials
  biz_tax_returns: ["IRS_1065", "IRS_1120", "IRS_1120S"],
  personal_tax_returns: ["IRS_1040", "K1"],
  interim_financials: ["FINANCIAL_STATEMENT"],
  debt_schedule: ["FINANCIAL_STATEMENT", "UNKNOWN"],

  // SBA
  sba_forms: ["UNKNOWN"],
  id_docs: ["UNKNOWN"],

  // CRE
  purchase_contract_or_payoff: ["UNKNOWN"],
  rent_roll: ["UNKNOWN"],
  leases: ["LEASE"],
  insurance: ["UNKNOWN"],
  property_details: ["UNKNOWN"],

  // 504 project
  project_sources_uses: ["UNKNOWN"],
  purchase_contract_or_budget: ["UNKNOWN"],

  // LOC / working capital
  ar_aging: ["UNKNOWN"],
  inventory_report: ["UNKNOWN"],
  bank_statements: ["BANK_STATEMENT"],

  // Equipment
  equipment_quote: ["INVOICE", "UNKNOWN"],
  vendor_w9: ["UNKNOWN"],
};
