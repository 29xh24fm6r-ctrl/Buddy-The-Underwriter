/**
 * SPEC-FINENGINE-LIVE-SPREAD-1 — Phase 2: canonical fact view.
 *
 * The metric library takes named scalar inputs (currentAssets, revenue, …) but
 * live facts arrive under extraction keys — balance-sheet lines are Schedule-L
 * `SL_*`, revenue is `GROSS_RECEIPTS`/`TOTAL_REVENUE`/`TOTAL_INCOME`, etc.
 * `canonicalView` maps one certified period's flat fact map onto the canonical
 * inputs via documented fallback chains, recording WHICH source key fed each
 * field (provenance). Pure; null-safe; no cross-period borrowing (that already
 * happened — or didn't — in Phase 1).
 */

export type CanonicalInputs = {
  // Income statement
  revenue: number | null;
  cogs: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  operatingExpenses: number | null;
  netIncome: number | null;
  pretaxIncome: number | null;
  ebit: number | null;
  interestExpense: number | null;
  depreciation: number | null;
  amortization: number | null;
  officerComp: number | null;
  rent: number | null;
  // Balance sheet
  totalAssets: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  cash: number | null;
  accountsReceivable: number | null;
  inventory: number | null;
  accountsPayable: number | null;
  ppeGross: number | null;
  accumDepreciation: number | null;
  ppeNet: number | null;
  intangibles: number | null;
  retainedEarnings: number | null;
  fundedDebt: number | null;
  // Equity rollforward (M-2)
  beginningEquity: number | null;
  endingEquity: number | null;
  distributions: number | null;
};

export type CanonicalView = {
  v: CanonicalInputs;
  /** field → the source fact key actually used (or null/'derived'). */
  src: Partial<Record<keyof CanonicalInputs, string>>;
};

const n = (v: number | null | undefined): number | null => (v == null ? null : v);

/** First present key in the fallback chain; returns the value + the key that fed it. */
function pick(facts: Record<string, number | null>, keys: string[]): { value: number | null; key: string | null } {
  for (const k of keys) {
    const v = n(facts[k]);
    if (v != null) return { value: v, key: k };
  }
  return { value: null, key: null };
}

export function canonicalView(facts: Record<string, number | null>): CanonicalView {
  const src: CanonicalView["src"] = {};
  const set = (field: keyof CanonicalInputs, chain: string[]): number | null => {
    const { value, key } = pick(facts, chain);
    if (key) src[field] = key;
    return value;
  };

  const revenue = set("revenue", ["GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME", "NET_SALES_REVENUE"]);
  const cogs = set("cogs", ["COST_OF_GOODS_SOLD", "F1125A_COGS"]);
  let grossProfit = set("grossProfit", ["GROSS_PROFIT"]);
  if (grossProfit == null && revenue != null && cogs != null) {
    grossProfit = revenue - cogs;
    src.grossProfit = "derived(revenue−cogs)";
  }
  const operatingIncome = set("operatingIncome", ["OPERATING_INCOME"]);
  const operatingExpenses = set("operatingExpenses", ["TOTAL_OPERATING_EXPENSES"]);
  const netIncome = set("netIncome", ["NET_INCOME", "M2_NET_INCOME"]);
  const pretaxIncome = set("pretaxIncome", ["M1_TAXABLE_INCOME", "TAXABLE_INCOME", "ORDINARY_BUSINESS_INCOME"]);
  const interestExpense = set("interestExpense", ["INTEREST_EXPENSE"]);
  const depreciation = set("depreciation", ["DEPRECIATION"]);
  const amortization = set("amortization", ["AMORTIZATION"]);
  const officerComp = set("officerComp", ["OFFICER_COMPENSATION", "F1125E_COMPENSATION"]);
  const rent = set("rent", ["RENT_EXPENSE", "RENT_EXPENSE_IS"]);

  // EBIT: operating income if present, else pre-tax income + interest (interest "below the line").
  let ebit = operatingIncome;
  if (ebit == null && pretaxIncome != null) {
    ebit = pretaxIncome + (interestExpense ?? 0);
    src.ebit = "derived(pretax+interest)";
  } else if (ebit != null) {
    src.ebit = src.operatingIncome ?? "OPERATING_INCOME";
  }

  const totalAssets = set("totalAssets", ["SL_TOTAL_ASSETS", "TOTAL_ASSETS"]);
  const totalLiabilities = set("totalLiabilities", ["SL_TOTAL_LIABILITIES", "TOTAL_LIABILITIES"]);
  const equity = set("equity", ["SL_TOTAL_EQUITY", "TOTAL_EQUITY"]);
  const currentAssets = set("currentAssets", ["TOTAL_CURRENT_ASSETS"]);
  const currentLiabilities = set("currentLiabilities", ["TOTAL_CURRENT_LIABILITIES"]);
  const cash = set("cash", ["SL_CASH"]);
  const accountsReceivable = set("accountsReceivable", ["SL_AR_GROSS", "AR_TOTAL"]);
  const inventory = set("inventory", ["SL_INVENTORY", "F1125A_END_INVENTORY"]);
  const accountsPayable = set("accountsPayable", ["SL_ACCOUNTS_PAYABLE"]);
  const ppeGross = set("ppeGross", ["SL_PPE_GROSS"]);
  const accumDepreciation = set("accumDepreciation", ["SL_ACCUMULATED_DEPRECIATION"]);
  let ppeNet: number | null = null;
  if (ppeGross != null && accumDepreciation != null) {
    ppeNet = ppeGross - accumDepreciation;
    src.ppeNet = "derived(gross−accumDep)";
  }
  const intangibles = set("intangibles", ["SL_INTANGIBLES_GROSS"]);
  const retainedEarnings = set("retainedEarnings", ["SL_RETAINED_EARNINGS", "M2_RETAINED_EARNINGS_END", "RETAINED_EARNINGS"]);
  const fundedDebt = set("fundedDebt", ["SL_MORTGAGES_NOTES_BONDS"]);
  const beginningEquity = set("beginningEquity", ["M2_BALANCE_BOY"]);
  const endingEquity = set("endingEquity", ["M2_BALANCE_EOY"]);
  const distributions = set("distributions", ["M2_DISTRIBUTIONS"]);

  return {
    v: {
      revenue, cogs, grossProfit, operatingIncome, operatingExpenses, netIncome, pretaxIncome, ebit,
      interestExpense, depreciation, amortization, officerComp, rent,
      totalAssets, totalLiabilities, equity, currentAssets, currentLiabilities, cash, accountsReceivable,
      inventory, accountsPayable, ppeGross, accumDepreciation, ppeNet, intangibles, retainedEarnings, fundedDebt,
      beginningEquity, endingEquity, distributions,
    },
    src,
  };
}
