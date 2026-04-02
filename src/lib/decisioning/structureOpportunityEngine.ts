/**
 * Structure Opportunity Engine — Phase 66B Decision & Action Engine
 *
 * Pure function. Identifies lending structure improvement opportunities
 * based on deal metrics and loan type.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DealMetrics {
  dscr?: number;
  ltv?: number;
  debtYield?: number;
  currentRatio?: number;
  leverageRatio?: number;
  loanAmount?: number;
}

export interface StructureOpportunity {
  opportunity: string;
  description: string;
  impact: string;
  feasibility: "high" | "medium" | "low";
  currentMetric?: string;
  improvedMetric?: string;
}

// ---------------------------------------------------------------------------
// Opportunity detectors
// ---------------------------------------------------------------------------

function detectDscrOpportunities(
  metrics: DealMetrics,
  _loanType: string,
): StructureOpportunity[] {
  const ops: StructureOpportunity[] = [];

  if (metrics.dscr != null && metrics.dscr < 1.25) {
    ops.push({
      opportunity: "shorter_amortization",
      description: "Consider shorter amortization to improve DSCR through faster principal reduction",
      impact: "May improve DSCR by 0.05-0.15x depending on rate and term",
      feasibility: "high",
      currentMetric: `DSCR ${metrics.dscr.toFixed(2)}x`,
      improvedMetric: `Target DSCR >= 1.25x`,
    });

    if (metrics.dscr < 1.0) {
      ops.push({
        opportunity: "interest_only_period",
        description: "Consider an initial interest-only period to reduce near-term debt service burden",
        impact: "Reduces initial annual debt service, improving Year 1 DSCR significantly",
        feasibility: "medium",
        currentMetric: `DSCR ${metrics.dscr.toFixed(2)}x`,
        improvedMetric: `IO-period DSCR could exceed 1.25x`,
      });
    }
  }

  return ops;
}

function detectLtvOpportunities(
  metrics: DealMetrics,
  _loanType: string,
): StructureOpportunity[] {
  const ops: StructureOpportunity[] = [];

  if (metrics.ltv != null && metrics.ltv > 80) {
    ops.push({
      opportunity: "additional_collateral",
      description: "Additional collateral could reduce LTV below policy threshold",
      impact: "Bringing LTV below 80% may unlock better pricing and reduced reserves",
      feasibility: "medium",
      currentMetric: `LTV ${metrics.ltv.toFixed(1)}%`,
      improvedMetric: `Target LTV <= 80%`,
    });

    ops.push({
      opportunity: "equity_injection",
      description: "Increased borrower equity injection to reduce loan-to-value ratio",
      impact: "Direct LTV reduction proportional to additional equity",
      feasibility: "low",
      currentMetric: `LTV ${metrics.ltv.toFixed(1)}%`,
      improvedMetric: `Target LTV <= 75%`,
    });
  }

  return ops;
}

function detectDebtYieldOpportunities(
  metrics: DealMetrics,
  loanType: string,
): StructureOpportunity[] {
  const ops: StructureOpportunity[] = [];

  if (metrics.debtYield != null && metrics.debtYield < 10 && loanType !== "sba_7a") {
    ops.push({
      opportunity: "reduce_loan_amount",
      description: "Reducing loan amount would improve debt yield above the 10% institutional threshold",
      impact: "Higher debt yield signals stronger collateral coverage to credit committee",
      feasibility: "medium",
      currentMetric: `Debt Yield ${metrics.debtYield.toFixed(1)}%`,
      improvedMetric: `Target Debt Yield >= 10%`,
    });
  }

  return ops;
}

function detectLeverageOpportunities(
  metrics: DealMetrics,
  _loanType: string,
): StructureOpportunity[] {
  const ops: StructureOpportunity[] = [];

  if (metrics.leverageRatio != null && metrics.leverageRatio > 4.0) {
    ops.push({
      opportunity: "mezzanine_layer",
      description: "Consider mezzanine or subordinated debt layer to reduce senior leverage",
      impact: "Shifts risk to junior capital, improving senior credit metrics",
      feasibility: "low",
      currentMetric: `Leverage ${metrics.leverageRatio.toFixed(1)}x`,
      improvedMetric: `Senior leverage < 4.0x`,
    });
  }

  return ops;
}

function detectLiquidityOpportunities(
  metrics: DealMetrics,
  _loanType: string,
): StructureOpportunity[] {
  const ops: StructureOpportunity[] = [];

  if (metrics.currentRatio != null && metrics.currentRatio < 1.2) {
    ops.push({
      opportunity: "working_capital_reserve",
      description: "Establish a working capital reserve as a loan covenant to ensure ongoing liquidity",
      impact: "Protects against short-term cash crunches that could threaten debt service",
      feasibility: "high",
      currentMetric: `Current Ratio ${metrics.currentRatio.toFixed(2)}x`,
      improvedMetric: `Covenant: maintain >= 1.2x`,
    });
  }

  return ops;
}

function detectGeneralOpportunities(
  metrics: DealMetrics,
  loanType: string,
): StructureOpportunity[] {
  const ops: StructureOpportunity[] = [];

  if (loanType === "sba_7a" && metrics.loanAmount != null && metrics.loanAmount > 350_000) {
    ops.push({
      opportunity: "sba_express",
      description: "Loan may qualify for SBA Express processing if amount is under $500K",
      impact: "Faster approval timeline and simplified documentation requirements",
      feasibility: "high",
      currentMetric: `Loan Amount $${(metrics.loanAmount / 1000).toFixed(0)}K`,
    });
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Identify all applicable structure improvement opportunities for a deal.
 */
export function identifyOpportunities(
  metrics: DealMetrics,
  loanType: string,
): StructureOpportunity[] {
  return [
    ...detectDscrOpportunities(metrics, loanType),
    ...detectLtvOpportunities(metrics, loanType),
    ...detectDebtYieldOpportunities(metrics, loanType),
    ...detectLeverageOpportunities(metrics, loanType),
    ...detectLiquidityOpportunities(metrics, loanType),
    ...detectGeneralOpportunities(metrics, loanType),
  ];
}
