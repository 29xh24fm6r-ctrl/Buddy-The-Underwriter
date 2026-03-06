/**
 * Global Cash Flow — God Tier Phase 2C, Section 4
 *
 * Combined business + personal waterfall with K-1 double-count prevention.
 * Business NCADS + personal income − all debt service = Global DSCR.
 *
 * Pure function — no DB, no server imports.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PersonalIncomeItem = {
  source: string;
  annualAmount: number;
  isRecurring: boolean;
  entityIdIfK1?: string;       // if from K-1, which entity
  excludeIfInScope: boolean;   // true for K-1 from deal entities
};

export type DebtServiceItem = {
  description: string;
  annualAmount: number;
  entityId?: string;
};

export type GlobalCashFlowInput = {
  // Business entities — use consolidated NCADS
  consolidatedBusinessNcads: number | null;

  // Personal income — EXCLUDE K-1s from entities already in consolidation scope
  personalIncome: PersonalIncomeItem[];
  k1Exclusions: string[];       // entity_ids whose K-1 income to exclude

  // All debt service — both business and personal
  businessDebtService: DebtServiceItem[];
  personalDebtService: DebtServiceItem[];
  proposedDebtService: number;

  // Optional: personal living expense deduction
  personalLivingExpense?: number | null;
};

export type GlobalCashFlowStep = {
  step: number;
  label: string;
  canonicalKey: string;
  value: number | null;
};

export type GlobalCashFlowResult = {
  steps: GlobalCashFlowStep[];
  consolidatedBusinessNcads: number | null;
  personalIncomeGross: number;
  personalIncomeExcluded: number;
  personalIncomeNet: number;
  personalLivingExpense: number;
  netPersonalCashFlow: number;
  grossGlobalCashFlow: number | null;
  totalBusinessDebtService: number;
  totalPersonalDebtService: number;
  proposedDebtService: number;
  globalDebtService: number;
  netCashAfterAllObligations: number | null;
  globalDscr: number | null;
  k1ExcludedItems: PersonalIncomeItem[];
};

// ---------------------------------------------------------------------------
// Default personal living expense
// ---------------------------------------------------------------------------

const DEFAULT_PERSONAL_LIVING_EXPENSE = 36_000; // $36K minimum per spec

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export function computeGlobalCashFlow(
  input: GlobalCashFlowInput,
): GlobalCashFlowResult {
  const steps: GlobalCashFlowStep[] = [];
  const exclusionSet = new Set(input.k1Exclusions);
  const k1ExcludedItems: PersonalIncomeItem[] = [];

  // ----- Business NCADS -----
  steps.push({
    step: 1,
    label: "Consolidated Business NCADS",
    canonicalKey: "CONS_NCADS",
    value: input.consolidatedBusinessNcads,
  });

  // ----- Personal Income (with K-1 exclusions) -----
  let personalIncomeGross = 0;
  let personalIncomeExcluded = 0;

  for (const item of input.personalIncome) {
    personalIncomeGross += item.annualAmount;

    // K-1 double-count prevention
    if (item.excludeIfInScope && item.entityIdIfK1 && exclusionSet.has(item.entityIdIfK1)) {
      personalIncomeExcluded += item.annualAmount;
      k1ExcludedItems.push(item);
    }
  }

  const personalIncomeNet = personalIncomeGross - personalIncomeExcluded;

  steps.push({
    step: 2,
    label: "Gross Personal Income",
    canonicalKey: "PERSONAL_INCOME_GROSS",
    value: personalIncomeGross,
  });

  steps.push({
    step: 2.5,
    label: "K-1 Income Excluded (already in business)",
    canonicalKey: "K1_INCOME_EXCLUDED",
    value: -personalIncomeExcluded,
  });

  // ----- Personal Living Expense -----
  const personalLivingExpense = input.personalLivingExpense ?? DEFAULT_PERSONAL_LIVING_EXPENSE;

  steps.push({
    step: 3,
    label: "Personal Living Expense",
    canonicalKey: "PERSONAL_LIVING_EXPENSE",
    value: -personalLivingExpense,
  });

  const netPersonalCashFlow = personalIncomeNet - personalLivingExpense;

  steps.push({
    step: 3.5,
    label: "Net Personal Cash Flow Available",
    canonicalKey: "NET_PERSONAL_CASH_FLOW",
    value: netPersonalCashFlow,
  });

  // ----- Gross Global Cash Flow -----
  const grossGlobalCashFlow = input.consolidatedBusinessNcads !== null
    ? input.consolidatedBusinessNcads + netPersonalCashFlow
    : null;

  steps.push({
    step: 4,
    label: "Gross Global Cash Flow",
    canonicalKey: "GLOBAL_CASH_FLOW",
    value: grossGlobalCashFlow,
  });

  // ----- Debt Service (all obligations) -----
  const totalBusinessDebtService = input.businessDebtService.reduce(
    (sum, d) => sum + d.annualAmount, 0,
  );
  const totalPersonalDebtService = input.personalDebtService.reduce(
    (sum, d) => sum + d.annualAmount, 0,
  );

  const globalDebtService =
    totalBusinessDebtService + totalPersonalDebtService + input.proposedDebtService;

  steps.push({
    step: 5,
    label: "Business Debt Service",
    canonicalKey: "BUSINESS_DEBT_SERVICE",
    value: totalBusinessDebtService,
  });

  steps.push({
    step: 5.5,
    label: "Personal Debt Service",
    canonicalKey: "PERSONAL_DEBT_SERVICE",
    value: totalPersonalDebtService,
  });

  steps.push({
    step: 6,
    label: "Proposed New Debt Service",
    canonicalKey: "PROPOSED_DEBT_SERVICE",
    value: input.proposedDebtService,
  });

  steps.push({
    step: 6.5,
    label: "Total Global Debt Service",
    canonicalKey: "GLOBAL_DEBT_SERVICE",
    value: globalDebtService,
  });

  // ----- Net Cash After All Obligations -----
  const netCashAfterAllObligations = grossGlobalCashFlow !== null
    ? grossGlobalCashFlow - globalDebtService
    : null;

  steps.push({
    step: 7,
    label: "Net Cash After All Obligations",
    canonicalKey: "NET_CASH_AFTER_OBLIGATIONS",
    value: netCashAfterAllObligations,
  });

  // ----- Global DSCR -----
  const globalDscr = grossGlobalCashFlow !== null && globalDebtService > 0
    ? grossGlobalCashFlow / globalDebtService
    : null;

  steps.push({
    step: 8,
    label: "Global DSCR",
    canonicalKey: "GLOBAL_DSCR",
    value: globalDscr,
  });

  return {
    steps,
    consolidatedBusinessNcads: input.consolidatedBusinessNcads,
    personalIncomeGross,
    personalIncomeExcluded,
    personalIncomeNet,
    personalLivingExpense,
    netPersonalCashFlow,
    grossGlobalCashFlow,
    totalBusinessDebtService,
    totalPersonalDebtService,
    proposedDebtService: input.proposedDebtService,
    globalDebtService,
    netCashAfterAllObligations,
    globalDscr,
    k1ExcludedItems,
  };
}
