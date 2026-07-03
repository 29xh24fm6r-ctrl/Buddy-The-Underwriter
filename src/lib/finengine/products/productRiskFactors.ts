/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 7: Product Intelligence Framework.
 *
 * Per-product risk factor model — the risks an underwrite of this product must
 * address regardless of industry. Pure data. The credit-officer brain (PR 15)
 * unions these with industry risks (PR 6).
 */

import type { ProductKey } from "@/lib/finengine/registry/productMetricRegistry";

export const RISK_FACTORS_BY_PRODUCT: Record<ProductKey, readonly string[]> = {
  CI_TERM: ["repayment_from_cash_flow", "term_out_risk", "collateral_shortfall", "guarantor_support"],
  WORKING_CAPITAL_LINE: ["evergreen_risk", "cleanup_requirement", "trading_asset_quality", "seasonal_swing"],
  AR_REVOLVER: ["dilution", "concentration", "ineligible_aging", "advance_rate_adequacy"],
  ABL_REVOLVER: ["dilution", "inventory_obsolescence", "appraisal_freshness", "advance_rate_adequacy", "field_exam_frequency"],
  EQUIPMENT: ["collateral_depreciation", "useful_life_vs_term", "used_vs_new", "resale_market"],
  CRE_OWNER_OCCUPIED: ["occupancy_dependence", "business_repayment_dependence", "ltv", "environmental"],
  CRE_INVESTOR: ["vacancy", "tenant_concentration", "lease_rollover", "cap_rate_expansion", "refinance_risk"],
  CONSTRUCTION: ["cost_overrun", "completion_risk", "interest_reserve_adequacy", "contingency_adequacy", "lease_up_absorption"],
  SBA_7A: ["eligibility", "credit_elsewhere", "equity_injection", "collateral_adequacy", "affiliation"],
  SBA_504: ["eligibility", "equity_injection", "job_creation", "cdc_participation", "collateral_adequacy"],
  BUSINESS_ACQUISITION: ["goodwill", "transition_risk", "seller_note_standby", "customer_retention", "valuation_support"],
  FRANCHISE: ["franchisor_health", "royalty_burden", "territory_saturation", "ramp_up", "franchise_transfer"],
  GUIDANCE_LINE: ["uncommitted_nature", "advance_discretion", "aggregate_exposure"],
  RENEWAL_MODIFICATION: ["deterioration_since_origination", "payment_history", "collateral_revaluation", "covenant_compliance"],
};

export function riskFactorsForProduct(product: ProductKey): readonly string[] {
  return RISK_FACTORS_BY_PRODUCT[product] ?? [];
}
