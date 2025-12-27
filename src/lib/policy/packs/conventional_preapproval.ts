/**
 * Conventional Pre-Approval Policy Pack
 * 
 * Bank's conventional lending criteria for simulation.
 * Typically more conservative than SBA (no guarantee).
 */

export const CONVENTIONAL_PREAPPROVAL = {
  id: "CONV_PREAPPROVAL_V1",
  display_name: "Conventional Pre-Approval Check",
  
  /**
   * Hard gates
   */
  hard_gates: {
    // Credit requirements
    min_credit_score: 680, // Typical floor for conventional
    
    // Cash flow requirements
    min_global_dscr: 1.15, // Stricter than SBA
    
    // Leverage limits
    max_leverage: 3.5, // Debt/Equity ratio (stricter than SBA)
    
    // LTV limits (if collateral-based)
    max_ltv_real_estate: 0.75, // 75% LTV
    max_ltv_equipment: 0.80,
  },
  
  /**
   * Required data points
   */
  required_fields: [
    "business.financials.revenue_trailing_12",
    "business.financials.ebitda",
    "business.credit_score",
    "loan.use_of_proceeds",
    "ownership.structure",
  ],
  
  /**
   * Product limits (bank-specific, this is typical)
   */
  product_limits: {
    term_loan: {
      typical_min: 100_000,
      typical_max: 2_000_000,
      max_term_months: 84, // 7 years
    },
    line_of_credit: {
      typical_min: 50_000,
      typical_max: 1_000_000,
      max_term_months: 12, // Annual renewal
    },
    equipment_financing: {
      typical_min: 25_000,
      typical_max: 500_000,
      max_term_months: 60, // 5 years
    },
  },
  
  /**
   * Collateral requirements
   */
  collateral_preferences: [
    "real_estate",
    "equipment",
    "inventory",
    "accounts_receivable",
    "personal_guarantee", // Often required
  ],
} as const;
