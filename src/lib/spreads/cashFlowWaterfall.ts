/**
 * Cash Flow Waterfall — God Tier Phase 2, Layer 7
 *
 * 9-step waterfall from net income to DSCR per spec Section Layer 7.
 * Pure function — no DB, no server imports, fully traceable.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashFlowWaterfallInput = {
  // Step 1: Net income base
  netIncomeBase: number | null;

  // Step 2: Non-cash addbacks
  depreciation: number | null;
  amortization: number | null;
  sec179Normalized: number | null; // normalized over useful life
  bonusDepreciationNormalized: number | null; // normalized

  // Step 3: Interest addback
  interestExpense: number | null;

  // Step 4: QoE adjustments
  qoeNonRecurringIncomeTotal: number | null; // to deduct
  qoeNonRecurringExpenseTotal: number | null; // to add back

  // Step 5: Owner benefit add-backs
  addbackExcessCompensation: number | null;
  addbackOwnerInsurance: number | null;
  addbackAutoPersonalUse: number | null;
  addbackHomeOffice: number | null;
  addbackPersonalTravelMeals: number | null;
  addbackFamilyCompensation: number | null;
  addbackRentNormalization: number | null; // can be negative

  // Step 6: Tax provision (C-Corps)
  normalizedTaxProvision: number | null;

  // Step 7: Capital expenditures
  maintenanceCapex: number | null;

  // Step 8: Debt service
  annualDebtServiceTotal: number | null;

  // Entity type flag
  isPassThrough: boolean;
};

export type CashFlowWaterfallStep = {
  step: number;
  label: string;
  canonicalKey: string;
  value: number | null;
};

export type CashFlowWaterfallResult = {
  steps: CashFlowWaterfallStep[];
  cfNetIncomeBase: number | null;
  cfNoncashAddbacks: number | null;
  cfInterestAddback: number | null;
  cfEbitdaReported: number | null;
  cfQoeAdjustment: number | null;
  cfEbitdaAdjusted: number | null;
  cfOwnerBenefitAddbacks: number | null;
  cfEbitdaOwnerAdjusted: number | null;
  cfTaxProvisionNormalized: number | null;
  cfMaintenanceCapex: number | null;
  cfNcads: number | null;
  cfAnnualDebtService: number | null;
  cfCaads: number | null;
  ratioDscrFinal: number | null;
};

// ---------------------------------------------------------------------------
// Waterfall computation
// ---------------------------------------------------------------------------

export function computeCashFlowWaterfall(
  input: CashFlowWaterfallInput,
): CashFlowWaterfallResult {
  const steps: CashFlowWaterfallStep[] = [];

  // Step 1: Net Income Base
  const cfNetIncomeBase = input.netIncomeBase;
  steps.push({ step: 1, label: "Net Income Base", canonicalKey: "CF_NET_INCOME_BASE", value: cfNetIncomeBase });

  // Step 2: Non-cash addbacks
  const cfNoncashAddbacks = sumNullable([
    input.depreciation,
    input.amortization,
    input.sec179Normalized,
    input.bonusDepreciationNormalized,
  ]);
  steps.push({ step: 2, label: "Non-Cash Addbacks (D&A + normalized 179/bonus)", canonicalKey: "CF_NONCASH_ADDBACKS", value: cfNoncashAddbacks });

  // Step 3: Interest addback
  const cfInterestAddback = input.interestExpense;
  steps.push({ step: 3, label: "Interest Expense Addback", canonicalKey: "CF_INTEREST_ADDBACK", value: cfInterestAddback });

  // Step 4a: Reported EBITDA
  const cfEbitdaReported = sumNullable([cfNetIncomeBase, cfNoncashAddbacks, cfInterestAddback]);
  steps.push({ step: 4, label: "EBITDA (Reported)", canonicalKey: "CF_EBITDA_REPORTED", value: cfEbitdaReported });

  // Step 4b: QoE adjustment
  const qoeDeductions = input.qoeNonRecurringIncomeTotal ?? 0;
  const qoeAddbacks = input.qoeNonRecurringExpenseTotal ?? 0;
  const cfQoeAdjustment =
    input.qoeNonRecurringIncomeTotal !== null || input.qoeNonRecurringExpenseTotal !== null
      ? qoeAddbacks - qoeDeductions
      : null;
  steps.push({ step: 4.5, label: "QoE Adjustment", canonicalKey: "CF_QOE_ADJUSTMENT", value: cfQoeAdjustment });

  // Step 4c: Adjusted EBITDA
  const cfEbitdaAdjusted = addNullable(cfEbitdaReported, cfQoeAdjustment);
  steps.push({ step: 4.7, label: "EBITDA (Adjusted)", canonicalKey: "CF_EBITDA_ADJUSTED", value: cfEbitdaAdjusted });

  // Step 5: Owner benefit add-backs
  const cfOwnerBenefitAddbacks = sumNullable([
    input.addbackExcessCompensation,
    input.addbackOwnerInsurance,
    input.addbackAutoPersonalUse,
    input.addbackHomeOffice,
    input.addbackPersonalTravelMeals,
    input.addbackFamilyCompensation,
    input.addbackRentNormalization,
  ]);
  steps.push({ step: 5, label: "Owner Benefit Add-backs", canonicalKey: "CF_OWNER_BENEFIT_ADDBACKS", value: cfOwnerBenefitAddbacks });

  // Step 5b: Owner-adjusted EBITDA
  const cfEbitdaOwnerAdjusted = addNullable(cfEbitdaAdjusted, cfOwnerBenefitAddbacks);
  steps.push({ step: 5.5, label: "EBITDA (Owner-Adjusted)", canonicalKey: "CF_EBITDA_OWNER_ADJUSTED", value: cfEbitdaOwnerAdjusted });

  // Step 6: Tax provision (C-Corps only; pass-throughs = 0)
  const cfTaxProvisionNormalized = input.isPassThrough ? 0 : (input.normalizedTaxProvision ?? null);
  steps.push({ step: 6, label: "Normalized Tax Provision", canonicalKey: "CF_TAX_PROVISION_NORMALIZED", value: cfTaxProvisionNormalized });

  // Step 7: Maintenance CapEx
  const cfMaintenanceCapex = input.maintenanceCapex;
  steps.push({ step: 7, label: "Maintenance CapEx", canonicalKey: "CF_MAINTENANCE_CAPEX", value: cfMaintenanceCapex });

  // Step 7b: NCADS = Owner-Adjusted EBITDA - Taxes - CapEx
  const cfNcads = subtractAllNullable(
    cfEbitdaOwnerAdjusted,
    [cfTaxProvisionNormalized, cfMaintenanceCapex],
  );
  steps.push({ step: 7.5, label: "Net Cash Available for Debt Service (NCADS)", canonicalKey: "CF_NCADS", value: cfNcads });

  // Step 8: Annual debt service
  const cfAnnualDebtService = input.annualDebtServiceTotal;
  steps.push({ step: 8, label: "Annual Debt Service (P+I)", canonicalKey: "CF_ANNUAL_DEBT_SERVICE", value: cfAnnualDebtService });

  // Step 8b: CAADS
  const cfCaads = subtractNullable(cfNcads, cfAnnualDebtService);
  steps.push({ step: 8.5, label: "Cash After Debt Service (CAADS)", canonicalKey: "CF_CAADS", value: cfCaads });

  // Step 9: DSCR
  const ratioDscrFinal =
    cfNcads !== null && cfAnnualDebtService !== null && cfAnnualDebtService > 0
      ? cfNcads / cfAnnualDebtService
      : null;
  steps.push({ step: 9, label: "DSCR Final", canonicalKey: "RATIO_DSCR_FINAL", value: ratioDscrFinal });

  return {
    steps,
    cfNetIncomeBase,
    cfNoncashAddbacks,
    cfInterestAddback,
    cfEbitdaReported,
    cfQoeAdjustment,
    cfEbitdaAdjusted,
    cfOwnerBenefitAddbacks,
    cfEbitdaOwnerAdjusted,
    cfTaxProvisionNormalized,
    cfMaintenanceCapex,
    cfNcads,
    cfAnnualDebtService,
    cfCaads,
    ratioDscrFinal,
  };
}

// ---------------------------------------------------------------------------
// Null-safe arithmetic
// ---------------------------------------------------------------------------

function sumNullable(values: (number | null)[]): number | null {
  const nonNull = values.filter((v): v is number => v !== null);
  if (nonNull.length === 0) return null;
  return nonNull.reduce((a, b) => a + b, 0);
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function subtractNullable(a: number | null, b: number | null): number | null {
  if (a === null) return null;
  return a - (b ?? 0);
}

function subtractAllNullable(base: number | null, subs: (number | null)[]): number | null {
  if (base === null) return null;
  let result = base;
  for (const s of subs) {
    result -= s ?? 0;
  }
  return result;
}
