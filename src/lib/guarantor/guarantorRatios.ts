/**
 * Personal / Guarantor Financial Ratios — God Tier Spec Section 5F
 *
 * Pure-function module computing all 10 personal/guarantor ratios.
 * No DB, no server imports, fully deterministic.
 *
 * Key rules from spec 7B:
 *  - Pass-through income uses **lower of** 2yr avg vs current year
 *  - W-2 2yr avg = (year1 + year2) / 2
 *  - SE income 2yr avg: only if consistent or increasing; declining = use current year only
 *  - Post-close liquidity = liquid assets − down payment − closing costs
 */

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type GuarantorRatioInput = {
  // PFS-sourced
  totalPersonalAssets: number | null;
  totalPersonalLiabilities: number | null;
  liquidAssets: number | null;
  contingentLiabilities: number | null;

  // Loan terms
  proposedLoanAmount: number | null;
  downPayment: number | null;
  closingCosts: number | null;

  // Income — current year
  totalPersonalIncome: number | null;
  businessCashFlow: number | null;

  // Debt service
  totalPersonalDebtService: number | null;
  totalDebtService: number | null;
  monthlyDebtPayments: number | null;
  grossMonthlyIncome: number | null;

  // K-1 aggregate
  k1Items: K1IncomeItem[];

  // W-2 history (up to 2 years)
  w2Year1: number | null;
  w2Year2: number | null;

  // Self-employment income history (up to 2 years)
  seIncomeYear1: number | null;
  seIncomeYear2: number | null;
};

export type K1IncomeItem = {
  ordinaryIncome: number;
  ownershipPct: number; // 0–100
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type GuarantorRatioResult = {
  personalNetWorth: number | null;
  personalLiquidityPct: number | null;
  personalDscr: number | null;
  globalDscr: number | null;
  contingentLiabilitiesTotal: number | null;
  k1AggregateIncome: number | null;
  w2TwoYearAvg: number | null;
  seIncomeTwoYearAvg: number | null;
  personalDtiPct: number | null;
  postCloseLiquidity: number | null;
};

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

export function computeGuarantorRatios(
  input: GuarantorRatioInput,
): GuarantorRatioResult {
  // 1. Personal Net Worth = Total Assets − Total Liabilities
  const personalNetWorth = safeSubtract(
    input.totalPersonalAssets,
    input.totalPersonalLiabilities,
  );

  // 2. Personal Liquidity % = Liquid Assets ÷ Proposed Loan Amount × 100
  const personalLiquidityPct = safeDivide(
    input.liquidAssets,
    input.proposedLoanAmount,
    100,
  );

  // 3. Personal DSCR = Total Personal Income ÷ Total Personal Debt Service
  const personalDscr = safeDivide(
    input.totalPersonalIncome,
    input.totalPersonalDebtService,
  );

  // 4. Global DSCR = (Business Cash Flow + Personal Income) ÷ Total Debt Service
  const globalNumerator = safeAdd(input.businessCashFlow, input.totalPersonalIncome);
  const globalDscr = safeDivide(globalNumerator, input.totalDebtService);

  // 5. Contingent Liabilities Total — passthrough
  const contingentLiabilitiesTotal = input.contingentLiabilities;

  // 6. K-1 Aggregate Income = Sum(Box 1 × ownership %) across all entities
  const k1AggregateIncome = computeK1Aggregate(input.k1Items);

  // 7. W-2 2yr avg = (Year 1 + Year 2) ÷ 2
  const w2TwoYearAvg = computeW2TwoYearAvg(input.w2Year1, input.w2Year2);

  // 8. SE Income 2yr avg — only if consistent or increasing; declining = current year only
  const seIncomeTwoYearAvg = computeSeIncomeTwoYearAvg(
    input.seIncomeYear1,
    input.seIncomeYear2,
  );

  // 9. Personal DTI % = Monthly Debt Payments ÷ Gross Monthly Income × 100
  const personalDtiPct = safeDivide(
    input.monthlyDebtPayments,
    input.grossMonthlyIncome,
    100,
  );

  // 10. Post-Close Liquidity = Liquid Assets − Down Payment − Closing Costs
  const postCloseLiquidity = computePostCloseLiquidity(
    input.liquidAssets,
    input.downPayment,
    input.closingCosts,
  );

  return {
    personalNetWorth,
    personalLiquidityPct,
    personalDscr,
    globalDscr,
    contingentLiabilitiesTotal,
    k1AggregateIncome,
    w2TwoYearAvg,
    seIncomeTwoYearAvg,
    personalDtiPct,
    postCloseLiquidity,
  };
}

// ---------------------------------------------------------------------------
// K-1 aggregate: Sum(ordinaryIncome × ownershipPct / 100)
// ---------------------------------------------------------------------------

function computeK1Aggregate(items: K1IncomeItem[]): number | null {
  if (items.length === 0) return null;
  let total = 0;
  for (const item of items) {
    total += item.ordinaryIncome * (item.ownershipPct / 100);
  }
  return total;
}

// ---------------------------------------------------------------------------
// W-2 2yr avg per GSE/SBA guidelines
// ---------------------------------------------------------------------------

function computeW2TwoYearAvg(
  year1: number | null,
  year2: number | null,
): number | null {
  if (year1 !== null && year2 !== null) {
    return (year1 + year2) / 2;
  }
  // Only 1 year available — return that year
  if (year1 !== null) return year1;
  if (year2 !== null) return year2;
  return null;
}

// ---------------------------------------------------------------------------
// SE Income 2yr avg — spec 7B: only if consistent or increasing
// Declining = use current year only (year1 = most recent)
// ---------------------------------------------------------------------------

function computeSeIncomeTwoYearAvg(
  year1: number | null, // most recent year
  year2: number | null, // prior year
): number | null {
  if (year1 === null) return null;
  if (year2 === null) return year1;

  // If declining (current < prior), use current year only
  if (year1 < year2) return year1;

  // Consistent or increasing — use 2yr average
  return (year1 + year2) / 2;
}

// ---------------------------------------------------------------------------
// Post-close liquidity = Liquid Assets − Down Payment − Closing Costs
// ---------------------------------------------------------------------------

function computePostCloseLiquidity(
  liquidAssets: number | null,
  downPayment: number | null,
  closingCosts: number | null,
): number | null {
  if (liquidAssets === null) return null;
  const dp = downPayment ?? 0;
  const cc = closingCosts ?? 0;
  return liquidAssets - dp - cc;
}

// ---------------------------------------------------------------------------
// Safe arithmetic helpers — null propagation
// ---------------------------------------------------------------------------

function safeDivide(
  numerator: number | null,
  denominator: number | null,
  multiplier = 1,
): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return (numerator / denominator) * multiplier;
}

function safeAdd(
  a: number | null,
  b: number | null,
): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function safeSubtract(
  a: number | null,
  b: number | null,
): number | null {
  if (a === null || b === null) return null;
  return a - b;
}
