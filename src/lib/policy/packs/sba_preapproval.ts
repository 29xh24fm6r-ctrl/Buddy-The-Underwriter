/**
 * SBA Pre-Approval Policy Pack
 * 
 * Lightweight rules for simulating SBA viability without full underwriting.
 * This is NOT the full SBA SOP 50 10 - it's a "can we get close?" check.
 */

export const SBA_PREAPPROVAL = {
  id: "SBA_PREAPPROVAL_V1",
  display_name: "SBA Pre-Approval Check",
  
  /**
   * Hard gates (must pass to show "pass" or "conditional")
   */
  hard_gates: {
    // Business must be for-profit
    must_be_for_profit: true,
    
    // Must be operating in US
    must_be_us_based: true,
    
    // Size standards (SBA uses NAICS-specific, this is simplified)
    max_annual_revenue_hint: 40_000_000, // $40M common threshold
    max_employees_hint: 500,
    
    // Use of proceeds restrictions
    prohibited_uses: [
      "passive_real_estate",
      "lending",
      "gambling",
      "speculation",
      "pyramid_schemes",
    ],
  },
  
  /**
   * Required data points for simulation
   */
  required_fields: [
    "borrower.citizenship_status",
    "business.naics_code",
    "business.entity_type",
    "loan.use_of_proceeds",
    "ownership.structure",
  ],
  
  /**
   * Informational thresholds (not hard gates, but used in offers)
   */
  targets: {
    min_global_dscr_hint: 1.10, // SBA wants "adequate repayment ability"
    max_leverage_hint: 4.0, // Debt/Equity ratio target
  },
  
  /**
   * SBA 7(a) product limits
   */
  product_limits: {
    sba_7a: {
      max_loan_amount: 5_000_000,
      typical_min: 50_000,
      typical_max_term_months: 120, // 10 years for working capital
      max_term_months_real_estate: 300, // 25 years for RE
    },
    sba_express: {
      max_loan_amount: 500_000,
      typical_min: 50_000,
      typical_max_term_months: 84, // 7 years
    },
  },
} as const;
