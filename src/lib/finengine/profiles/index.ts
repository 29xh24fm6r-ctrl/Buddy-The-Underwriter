/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 5: product PROFILES.
 *
 * Each product is a CONFIG object over the shared core (NG3 — config, not an
 * engine): repayment-source hierarchy, eligible methods, sizing constraints,
 * collateral model, and the policy overlay id that resolves in the registry.
 * Priority products are fully specified; the long tail are real configs / stubs.
 *
 * Pure — no DB, no server-only.
 */

import type { ProductProfile } from "@/lib/finengine/contracts";

const P = (p: ProductProfile): ProductProfile => p;

export const PRODUCT_PROFILES: Record<string, ProductProfile> = {
  // ---- Priority products (fully specified) -------------------------------
  CI_TERM: P({
    productId: "CI_TERM",
    label: "C&I Term Loan",
    repaymentSourceHierarchy: ["business_cf", "collateral_conversion"],
    eligibleMethods: ["ADJ_EBITDA", "TRADITIONAL", "UCA", "GLOBAL"],
    sizingConstraints: ["DSCR", "MOST_RESTRICTIVE_OF"],
    collateralModel: "BLANKET_UCC",
    policyOverlayId: "ci_standard",
  }),
  SBA_7A_STANDARD: P({
    productId: "SBA_7A_STANDARD",
    label: "SBA 7(a) Standard",
    repaymentSourceHierarchy: ["business_cf", "collateral_conversion"],
    eligibleMethods: ["ADJ_EBITDA", "GLOBAL", "SDE"],
    sizingConstraints: ["DSCR", "SBA_PROGRAM_CAP", "EQUITY_INJECTION"],
    collateralModel: "BLANKET_UCC",
    policyOverlayId: "sba_7a_standard",
  }),
  SBA_7A_SMALL: P({
    productId: "SBA_7A_SMALL",
    label: "SBA 7(a) Small",
    repaymentSourceHierarchy: ["business_cf", "collateral_conversion"],
    eligibleMethods: ["ADJ_EBITDA", "GLOBAL", "SDE"],
    sizingConstraints: ["DSCR", "SBA_PROGRAM_CAP", "EQUITY_INJECTION"],
    collateralModel: "BLANKET_UCC",
    policyOverlayId: "sba_7a_small",
  }),
  SBA_504: P({
    productId: "SBA_504",
    label: "SBA 504",
    repaymentSourceHierarchy: ["business_cf", "property_noi", "collateral_conversion"],
    eligibleMethods: ["ADJ_EBITDA", "GLOBAL", "CRE_NOI"],
    sizingConstraints: ["DSCR", "LTV", "OCCUPANCY", "EQUITY_INJECTION", "SBA_PROGRAM_CAP"],
    collateralModel: "SBA_504_STACK",
    policyOverlayId: "sba_504",
  }),
  ABL_REVOLVER: P({
    productId: "ABL_REVOLVER",
    label: "Asset-Based Revolver",
    repaymentSourceHierarchy: ["collateral_conversion", "business_cf"],
    eligibleMethods: ["UCA", "TRADITIONAL"],
    sizingConstraints: ["BORROWING_BASE", "DSCR"],
    collateralModel: "AR_INVENTORY",
    policyOverlayId: "abl_standard",
  }),
  WORKING_CAPLINE: P({
    productId: "WORKING_CAPLINE",
    label: "SBA CAPLine (Working Capital)",
    repaymentSourceHierarchy: ["collateral_conversion", "business_cf"],
    eligibleMethods: ["UCA", "TRADITIONAL"],
    sizingConstraints: ["BORROWING_BASE", "CAPLINE_RULE", "SBA_PROGRAM_CAP"],
    collateralModel: "AR_INVENTORY",
    policyOverlayId: "sba_capline",
  }),
  CRE_OWNER_OCC: P({
    productId: "CRE_OWNER_OCC",
    label: "CRE Owner-Occupied",
    repaymentSourceHierarchy: ["business_cf", "property_noi", "collateral_conversion"],
    eligibleMethods: ["ADJ_EBITDA", "GLOBAL", "CRE_NOI"],
    sizingConstraints: ["DSCR", "LTV", "DEBT_YIELD", "OCCUPANCY", "MOST_RESTRICTIVE_OF"],
    collateralModel: "CRE",
    policyOverlayId: "cre_owner_occ",
  }),
  CRE_INVESTOR: P({
    productId: "CRE_INVESTOR",
    label: "CRE Investor",
    repaymentSourceHierarchy: ["property_noi", "collateral_conversion"],
    eligibleMethods: ["CRE_NOI"],
    sizingConstraints: ["DSCR", "LTV", "DEBT_YIELD", "MOST_RESTRICTIVE_OF"],
    collateralModel: "CRE",
    policyOverlayId: "cre_investor",
  }),
  EQUIPMENT: P({
    productId: "EQUIPMENT",
    label: "Equipment Finance",
    repaymentSourceHierarchy: ["business_cf", "asset_resale"],
    eligibleMethods: ["ADJ_EBITDA", "TRADITIONAL"],
    sizingConstraints: ["DSCR", "LTV"],
    collateralModel: "EQUIPMENT",
    policyOverlayId: "equipment_standard",
  }),
  CONSTRUCTION: P({
    productId: "CONSTRUCTION",
    label: "Construction",
    repaymentSourceHierarchy: ["forward_sales", "property_noi", "collateral_conversion"],
    eligibleMethods: ["CRE_NOI", "GLOBAL"],
    sizingConstraints: ["LTV", "DSCR", "MOST_RESTRICTIVE_OF"],
    collateralModel: "CRE",
    policyOverlayId: "construction_standard",
  }),
  ACQUISITION: P({
    productId: "ACQUISITION",
    label: "Business Acquisition",
    repaymentSourceHierarchy: ["business_cf", "collateral_conversion"],
    eligibleMethods: ["ADJ_EBITDA", "SDE", "GLOBAL"],
    sizingConstraints: ["DSCR", "EQUITY_INJECTION"],
    collateralModel: "BLANKET_UCC",
    policyOverlayId: "acquisition_standard",
  }),
  FRANCHISE: P({
    productId: "FRANCHISE",
    label: "Franchise",
    repaymentSourceHierarchy: ["business_cf", "collateral_conversion"],
    eligibleMethods: ["ADJ_EBITDA", "SDE", "GLOBAL"],
    sizingConstraints: ["DSCR", "EQUITY_INJECTION", "SBA_PROGRAM_CAP"],
    collateralModel: "BLANKET_UCC",
    policyOverlayId: "franchise_standard",
  }),
};

/** Long-tail product stubs — real profiles to be elaborated in later iterations. */
const STUB_PRODUCTS: Array<{ id: string; label: string; collateral: ProductProfile["collateralModel"] }> = [
  { id: "FACTORING", label: "Factoring", collateral: "AR_INVENTORY" },
  { id: "MCA", label: "Merchant Cash Advance", collateral: "NONE" },
  { id: "MEZZANINE", label: "Mezzanine", collateral: "NONE" },
  { id: "LOC_REVOLVER", label: "Line of Credit Revolver", collateral: "BLANKET_UCC" },
  { id: "AG", label: "Agricultural", collateral: "BLANKET_UCC" },
  { id: "LETTER_OF_CREDIT", label: "Letter of Credit", collateral: "NONE" },
  { id: "RENEWAL_MOD_EXTENSION", label: "Renewal / Mod / Extension", collateral: "BLANKET_UCC" },
];
for (const s of STUB_PRODUCTS) {
  PRODUCT_PROFILES[s.id] = P({
    productId: s.id,
    label: s.label,
    repaymentSourceHierarchy: ["business_cf"],
    eligibleMethods: ["TRADITIONAL"],
    sizingConstraints: ["DSCR"],
    collateralModel: s.collateral,
    policyOverlayId: "stub",
  });
}

export function getProfile(productId: string): ProductProfile | undefined {
  return PRODUCT_PROFILES[productId];
}

export function listProfiles(): string[] {
  return Object.keys(PRODUCT_PROFILES);
}
