/**
 * Deal Type Detection — pure function
 *
 * Detects deal type from canonical facts using priority-ordered heuristics.
 * No DB, no server imports.
 */

import type { DealType } from "./types";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function detectDealType(facts: Record<string, unknown>): DealType {
  // 1. Explicit override
  const override = facts["deal_type_override"];
  if (typeof override === "string" && isValidDealType(override)) {
    return override;
  }

  // 2. Appraisal + rental income → CRE investor
  const hasAppraisal = Boolean(facts["appraisal_present"] || facts["appraised_value"]);
  const rentalIncome = toNum(facts["rental_income"]) ?? toNum(facts["sch_e_rents_received"]) ?? toNum(facts["SCH_E_RENTS_RECEIVED"]);
  if (hasAppraisal && rentalIncome !== null && rentalIncome > 0) {
    return "cre_investor";
  }

  // 3. Construction signals
  const hasBudget = Boolean(facts["construction_budget_present"]);
  const loanPurpose = String(facts["loan_purpose"] ?? "").toLowerCase();
  if (hasBudget || loanPurpose.includes("construction")) {
    return "cre_construction";
  }

  // 4. SBA form present
  if (facts["sba_form_present"] || loanPurpose.includes("sba")) {
    return "sba_7a";
  }

  // 5. Rental income > 80% of revenue → CRE investor
  const totalRevenue = toNum(facts["TOTAL_REVENUE"]) ?? toNum(facts["is_gross_revenue"]) ?? toNum(facts["GROSS_RECEIPTS"]);
  if (rentalIncome !== null && totalRevenue !== null && totalRevenue > 0) {
    if (rentalIncome / totalRevenue > 0.80) {
      return "cre_investor";
    }
  }

  // 6. Healthcare / professional practice (NAICS 62 + sole_prop/s_corp)
  const naics = String(facts["naics_code"] ?? "");
  const entityType = String(facts["entity_type"] ?? "").toLowerCase();
  if (naics.startsWith("62") && (entityType === "sole_prop" || entityType === "s_corp" || entityType === "sole_proprietorship")) {
    return "professional_practice";
  }

  // 7. Equipment financing
  const ppeAssets = toNum(facts["bs_ppe_net"]) ?? toNum(facts["PP_AND_E"]);
  const totalAssets = toNum(facts["TOTAL_ASSETS"]) ?? toNum(facts["bs_total_assets"]);
  if (ppeAssets !== null && totalAssets !== null && totalAssets > 0) {
    if (ppeAssets / totalAssets > 0.70 && loanPurpose.includes("equipment")) {
      return "equipment";
    }
  }

  // 8. Holding company
  const entityRoles = facts["entity_roles"];
  const entityCount = toNum(facts["entity_count"]);
  if (Array.isArray(entityRoles) && entityRoles.includes("re_holding") && entityCount !== null && entityCount > 1) {
    return "holding_company";
  }

  // 9. Agriculture (NAICS 11)
  if (naics.startsWith("11")) {
    return "agriculture";
  }

  // 10. CRE owner-occupied heuristic (real estate NAICS)
  if (naics.startsWith("53")) {
    return "cre_owner_occupied";
  }

  // Default
  return "c_and_i";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

const VALID_DEAL_TYPES = new Set<string>([
  "c_and_i", "cre_owner_occupied", "cre_investor", "cre_construction",
  "sba_7a", "sba_504", "agriculture", "multifamily", "healthcare",
  "franchise", "professional_practice", "non_profit", "holding_company",
  "acquisition", "equipment", "working_capital",
]);

function isValidDealType(val: string): val is DealType {
  return VALID_DEAL_TYPES.has(val);
}
