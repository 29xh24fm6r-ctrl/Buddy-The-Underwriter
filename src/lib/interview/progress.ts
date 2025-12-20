// src/lib/interview/progress.ts
import type { AllowedFactKey } from "@/lib/interview/factKeys";

/**
 * Base required facts for ANY deal intake.
 * Keep this list short and high-signal. Everything else is optional or loan-type specific.
 */
export const BASE_REQUIRED_FACT_KEYS: AllowedFactKey[] = [
  "loan_type_requested",
  "requested_amount",
  "loan_purpose",
  "use_of_proceeds",

  "legal_business_name",
  "entity_type",
  "business_address",

  "best_contact_name",
  "best_contact_phone",
  "best_contact_email",
];

/**
 * Loan-type specific requirements.
 * These are only required if loan_type_requested is confirmed to match.
 */
export const LOAN_TYPE_REQUIRED: Record<string, AllowedFactKey[]> = {
  SBA_7A: [
    "business_start_date",
    "ein",
    "owners",
    "primary_owner_name",
    "primary_owner_percent",
    "sba_ineligible_business_flags",
  ],
  CRE: ["real_estate_address", "purchase_price", "down_payment_amount", "down_payment_source"],
  LOC: ["annual_revenue", "cash_on_hand", "existing_debt_summary"],
  TERM: ["annual_revenue", "net_income", "existing_debt_summary"],
  EQUIPMENT: ["use_of_proceeds", "project_cost_total", "down_payment_amount", "down_payment_source"],
};

export function normalizeLoanType(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (!s) return null;

  // Accept common variants from borrowers/bankers
  if (s.includes("SBA") && (s.includes("7A") || s.includes("7(A)") || s.includes("7-A"))) return "SBA_7A";
  if (s.includes("CRE") || s.includes("REAL ESTATE") || s.includes("REAL-ESTATE")) return "CRE";
  if (s.includes("LOC") || s.includes("LINE OF CREDIT") || s.includes("REVOLV")) return "LOC";
  if (s.includes("TERM")) return "TERM";
  if (s.includes("EQUIP")) return "EQUIPMENT";

  // If they already say SBA_7A etc
  if (LOAN_TYPE_REQUIRED[s]) return s;

  return null;
}

/**
 * Returns the list of required keys given current confirmed facts.
 * Only counts keys as required that match the loan type (if known).
 */
export function getRequiredFactKeys(confirmedByKey: Map<string, any>): AllowedFactKey[] {
  const keys = new Set<AllowedFactKey>(BASE_REQUIRED_FACT_KEYS);

  const loanTypeRaw = confirmedByKey.get("loan_type_requested")?.field_value ?? confirmedByKey.get("loan_type_requested")?.value;
  const loanType = normalizeLoanType(loanTypeRaw);

  if (loanType && LOAN_TYPE_REQUIRED[loanType]) {
    for (const k of LOAN_TYPE_REQUIRED[loanType]) keys.add(k);
  }

  return Array.from(keys);
}
