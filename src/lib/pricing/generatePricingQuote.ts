import type { RiskFacts } from "../risk/normalizeRiskFacts";

export type PricingQuote = {
  product: "bridge" | "perm" | "construction";
  rate: {
    margin_bps: number;
    index: string;
    floor: number;
    all_in_rate: number;
  };
  fees: {
    origination: number;
    underwriting: number;
    legal: number;
    exit: number;
  };
  structure: {
    ltv_limit: number;
    dscr_min: number;
    reserves: number;
    covenants: string[];
  };
  conditions: {
    precedent: string[];
    ongoing: string[];
  };
  rationale: string;
  sensitivities: {
    base: { rate: number; payment: number };
    upside: { rate: number; payment: number };
    downside: { rate: number; payment: number };
  };
};

export type PricingAssumptions = {
  risk_rating: number;
  base_margin_bps: number;
  adjustments: Array<{
    factor: string;
    impact_bps: number;
    reason: string;
  }>;
  market_conditions: string;
};

/**
 * Generate default pricing quote from normalized risk facts
 * 
 * This is a simplified example - enhance with your actual pricing logic
 */
export function generatePricingQuote(facts: RiskFacts): {
  quote: PricingQuote;
  assumptions: PricingAssumptions;
} {
  // Base risk rating (1-10 scale)
  const risk_rating = calculateRiskRating(facts);

  // Base margin based on risk
  const base_margin_bps = 300 + (risk_rating - 5) * 50; // 300bps at rating 5

  // Calculate adjustments
  const adjustments: Array<{ factor: string; impact_bps: number; reason: string }> = [];

  // DSCR adjustment
  if (facts.collateral.dscr && facts.collateral.dscr < 1.25) {
    adjustments.push({
      factor: "Low DSCR",
      impact_bps: 50,
      reason: `DSCR ${facts.collateral.dscr.toFixed(2)} below 1.25 threshold`,
    });
  }

  // LTV adjustment
  if (facts.collateral.ltv && facts.collateral.ltv > 75) {
    adjustments.push({
      factor: "High LTV",
      impact_bps: 25,
      reason: `LTV ${facts.collateral.ltv}% above 75% threshold`,
    });
  }

  // Recourse adjustment
  if (facts.loan.recourse_type === "non-recourse") {
    adjustments.push({
      factor: "Non-recourse",
      impact_bps: 75,
      reason: "Non-recourse loan increases lender risk",
    });
  }

  // Policy exceptions
  if (facts.exceptions.length > 0) {
    const highSeverity = facts.exceptions.filter(e => e.severity === "high").length;
    if (highSeverity > 0) {
      adjustments.push({
        factor: "Policy Exceptions",
        impact_bps: highSeverity * 25,
        reason: `${highSeverity} high-severity policy exception(s)`,
      });
    }
  }

  const total_adjustments = adjustments.reduce((sum, a) => sum + a.impact_bps, 0);
  const final_margin_bps = base_margin_bps + total_adjustments;

  // Example: SOFR + margin
  const sofr_rate = 0.0535; // 5.35% - would come from market data in production
  const all_in_rate = sofr_rate + final_margin_bps / 10000;

  // Calculate payment (simple interest for bridge loan)
  const requested_amount = facts.loan.requested_amount ?? 1000000;
  const term_months = facts.loan.term_months ?? 24;
  const monthly_payment = (requested_amount * all_in_rate) / 12;

  const quote: PricingQuote = {
    product: "bridge", // Default to bridge
    rate: {
      margin_bps: final_margin_bps,
      index: "SOFR",
      floor: 0.0,
      all_in_rate: Number(all_in_rate.toFixed(4)),
    },
    fees: {
      origination: requested_amount * 0.01, // 1%
      underwriting: 5000,
      legal: 7500,
      exit: requested_amount * 0.005, // 0.5%
    },
    structure: {
      ltv_limit: 75,
      dscr_min: 1.25,
      reserves: requested_amount * 0.05, // 5%
      covenants: [
        "Maintain minimum DSCR of 1.25x",
        "Maintain occupancy above 85%",
        "Provide quarterly financial statements",
      ],
    },
    conditions: {
      precedent: [
        "Satisfactory appraisal",
        "Phase I environmental report",
        "Title insurance",
        "Property insurance",
        "All legal documentation executed",
      ],
      ongoing: [
        "Quarterly financial reporting",
        "Annual property inspection",
        "Maintain required insurance coverage",
      ],
    },
    rationale: `Pricing reflects ${risk_rating}/10 risk rating with base margin of ${base_margin_bps}bps. ` +
      `Adjustments totaling ${total_adjustments}bps applied for: ${adjustments.map(a => a.factor).join(", ") || "none"}. ` +
      `Final all-in rate of ${(all_in_rate * 100).toFixed(2)}% (SOFR + ${final_margin_bps}bps).`,
    sensitivities: {
      base: {
        rate: all_in_rate,
        payment: monthly_payment,
      },
      upside: {
        rate: all_in_rate - 0.005, // -50bps
        payment: monthly_payment * 0.95,
      },
      downside: {
        rate: all_in_rate + 0.005, // +50bps
        payment: monthly_payment * 1.05,
      },
    },
  };

  const assumptions: PricingAssumptions = {
    risk_rating,
    base_margin_bps,
    adjustments,
    market_conditions: "Current SOFR-based pricing with standard market spreads",
  };

  return { quote, assumptions };
}

function calculateRiskRating(facts: RiskFacts): number {
  let rating = 5; // Start at medium risk

  // Positive factors (reduce risk)
  if (facts.collateral.dscr && facts.collateral.dscr >= 1.5) rating -= 1;
  if (facts.collateral.ltv && facts.collateral.ltv <= 65) rating -= 1;
  if (facts.borrower.sponsor_experience_years && facts.borrower.sponsor_experience_years >= 10) rating -= 1;
  if (facts.loan.recourse_type === "full-recourse") rating -= 1;

  // Negative factors (increase risk)
  if (facts.collateral.dscr && facts.collateral.dscr < 1.25) rating += 1;
  if (facts.collateral.ltv && facts.collateral.ltv > 75) rating += 1;
  if (facts.collateral.occupancy && facts.collateral.occupancy < 80) rating += 1;
  if (facts.exceptions.filter(e => e.severity === "high").length > 0) rating += 1;

  // Clamp to 1-10
  return Math.max(1, Math.min(10, rating));
}
