import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  CashFlowRow,
  ClassicSpreadInput,
  FinancialRow,
  RatioRow,
  RatioSection,
  StatementPeriod,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RawFact = {
  fact_key: string;
  fact_period_end: string | null;
  fact_value_num: number | null;
  confidence: number | null;
  created_at: string;
};

/** Group facts by period_end, picking the highest-confidence value per key per period. */
function buildPeriodMaps(facts: RawFact[]): {
  periods: string[]; // sorted ASC
  byPeriod: Map<string, Map<string, number | null>>;
} {
  const periodSet = new Set<string>();
  // Group: period → key → best fact
  const grouped = new Map<string, Map<string, RawFact>>();

  for (const f of facts) {
    const pe = f.fact_period_end?.slice(0, 10);
    if (!pe || f.fact_value_num == null) continue;
    // PFS statements use a statement date, not a fiscal year-end.
    // Never create a financial spread column for PFS data.
    if (f.fact_key.startsWith("PFS_") || f.fact_key === "PERSONAL_FINANCIAL_STATEMENT") continue;
    periodSet.add(pe);

    if (!grouped.has(pe)) grouped.set(pe, new Map());
    const periodMap = grouped.get(pe)!;
    const existing = periodMap.get(f.fact_key);
    if (
      !existing ||
      (f.confidence ?? 0) > (existing.confidence ?? 0) ||
      ((f.confidence ?? 0) === (existing.confidence ?? 0) && f.created_at > existing.created_at)
    ) {
      periodMap.set(f.fact_key, f);
    }
  }

  // Cap at 4 periods to prevent layout overflow (each period ~116pt, 4 × 116 = 464pt ≤ 540pt usable)
  const MAX_PERIODS = 4;
  let periods = Array.from(periodSet).sort();
  if (periods.length > MAX_PERIODS) {
    periods = periods.slice(-MAX_PERIODS); // keep most recent
  }
  const byPeriod = new Map<string, Map<string, number | null>>();
  for (const pe of periods) {
    const m = new Map<string, number | null>();
    const raw = grouped.get(pe);
    if (raw) {
      for (const [k, f] of raw) m.set(k, f.fact_value_num);
    }
    byPeriod.set(pe, m);
  }

  return { periods, byPeriod };
}

function formatPeriodDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${parseInt(m!, 10)}/${parseInt(d!, 10)}/${y}`;
}

function derivePeriodLabel(isoDate: string, currentYear: number): string {
  const y = parseInt(isoDate.slice(0, 4), 10);
  const m = parseInt(isoDate.slice(5, 7), 10);
  const d = parseInt(isoDate.slice(8, 10), 10);
  // If period ends mid-year (not Dec 31), treat as YTD
  if (m !== 12 || d !== 31) {
    return y === currentYear ? `YTD ${y}` : `${y}`;
  }
  return `${y}`;
}

function deriveMonths(isoDate: string): number {
  const m = parseInt(isoDate.slice(5, 7), 10);
  const d = parseInt(isoDate.slice(8, 10), 10);
  if (m === 12 && d === 31) return 12;
  return m; // approximate
}

function getVal(
  byPeriod: Map<string, Map<string, number | null>>,
  period: string,
  key: string,
): number | null {
  return byPeriod.get(period)?.get(key) ?? null;
}

function getVals(
  byPeriod: Map<string, Map<string, number | null>>,
  periods: string[],
  key: string,
): (number | null)[] {
  return periods.map((p) => getVal(byPeriod, p, key));
}

/** Get values for a key, trying multiple key names (fallback chain). */
function getValsFallback(
  byPeriod: Map<string, Map<string, number | null>>,
  periods: string[],
  ...keys: string[]
): (number | null)[] {
  return periods.map((p) => {
    for (const k of keys) {
      const v = getVal(byPeriod, p, k);
      if (v != null) return v;
    }
    return null;
  });
}

function deriveValues(
  periods: string[],
  fn: (period: string) => number | null,
): (number | null)[] {
  return periods.map(fn);
}

function sub(a: (number | null)[], b: (number | null)[]): (number | null)[] {
  return a.map((v, i) => (v != null && b[i] != null ? v - b[i]! : null));
}

// ---------------------------------------------------------------------------
// Row Builders
// ---------------------------------------------------------------------------

function buildBalanceSheetRows(
  byPeriod: Map<string, Map<string, number | null>>,
  periods: string[],
): FinancialRow[] {
  const totalAssets = getVals(byPeriod, periods, "SL_TOTAL_ASSETS");

  // --- Current Assets ---
  const cash = getVals(byPeriod, periods, "SL_CASH");
  const ar = getVals(byPeriod, periods, "SL_AR_GROSS");
  const arAllowance = getVals(byPeriod, periods, "SL_AR_ALLOWANCE");
  const netAr = sub(ar, arAllowance);
  const inventory = getVals(byPeriod, periods, "SL_INVENTORY");
  const usGov = getVals(byPeriod, periods, "SL_US_GOV_OBLIGATIONS");
  const taxExempt = getVals(byPeriod, periods, "SL_TAX_EXEMPT_SECURITIES");
  const otherCA = getVals(byPeriod, periods, "SL_OTHER_CURRENT_ASSETS");
  const totalCurrentAssets = deriveValues(periods, (p) => {
    const direct = getVal(byPeriod, p, "TOTAL_CURRENT_ASSETS") ?? getVal(byPeriod, p, "SL_TOTAL_CURRENT_ASSETS");
    if (direct != null) return direct;
    // Derive: sum of current asset components
    const components = [
      getVal(byPeriod, p, "SL_CASH"),
      (() => { const a = getVal(byPeriod, p, "SL_AR_GROSS"); return a != null ? a - (getVal(byPeriod, p, "SL_AR_ALLOWANCE") ?? 0) : null; })(),
      getVal(byPeriod, p, "SL_INVENTORY"),
      getVal(byPeriod, p, "SL_US_GOV_OBLIGATIONS"),
      getVal(byPeriod, p, "SL_TAX_EXEMPT_SECURITIES"),
      getVal(byPeriod, p, "SL_OTHER_CURRENT_ASSETS"),
    ];
    const nonNull = components.filter((v) => v != null) as number[];
    return nonNull.length > 0 ? nonNull.reduce((a, b) => a + b, 0) : null;
  });

  // --- Non-Current Assets ---
  const officerLoansRcv = getVals(byPeriod, periods, "SL_SHAREHOLDER_LOANS_RECEIVABLE");
  const mortgageLoans = getVals(byPeriod, periods, "SL_MORTGAGE_LOANS");
  const otherInvestments = getVals(byPeriod, periods, "SL_OTHER_INVESTMENTS");
  const ppeGross = getVals(byPeriod, periods, "SL_PPE_GROSS");
  const accumDepr = getVals(byPeriod, periods, "SL_ACCUMULATED_DEPRECIATION");
  const netFixed = sub(ppeGross, accumDepr);
  const depletable = getVals(byPeriod, periods, "SL_DEPLETABLE_ASSETS");
  const land = getVals(byPeriod, periods, "SL_LAND");
  const intangiblesGross = getVals(byPeriod, periods, "SL_INTANGIBLES_GROSS");
  const accumAmort = getVals(byPeriod, periods, "SL_ACCUMULATED_AMORTIZATION");
  const intangiblesNet = sub(intangiblesGross, accumAmort);
  const otherAssets = getVals(byPeriod, periods, "SL_OTHER_ASSETS");
  const totalNonCurrentAssets = deriveValues(periods, (p) => {
    const ta = getVal(byPeriod, p, "SL_TOTAL_ASSETS");
    const i = periods.indexOf(p);
    const tca = totalCurrentAssets[i];
    return ta != null && tca != null ? ta - tca : null;
  });

  // --- Current Liabilities ---
  const ap = getVals(byPeriod, periods, "SL_ACCOUNTS_PAYABLE");
  const wagesPayable = getVals(byPeriod, periods, "SL_WAGES_PAYABLE");
  const shortTermDebt = getVals(byPeriod, periods, "SL_SHORT_TERM_DEBT");
  const operatingCurrLiab = getVals(byPeriod, periods, "SL_OPERATING_CURRENT_LIABILITIES");
  const totalCurrentLiab = deriveValues(periods, (p) => {
    const direct = getVal(byPeriod, p, "TOTAL_CURRENT_LIABILITIES") ?? getVal(byPeriod, p, "SL_TOTAL_CURRENT_LIABILITIES");
    if (direct != null) return direct;
    // Derive from components
    const components = [
      getVal(byPeriod, p, "SL_ACCOUNTS_PAYABLE"),
      getVal(byPeriod, p, "SL_WAGES_PAYABLE"),
      getVal(byPeriod, p, "SL_SHORT_TERM_DEBT"),
      getVal(byPeriod, p, "SL_OPERATING_CURRENT_LIABILITIES"),
    ];
    const nonNull = components.filter((v) => v != null) as number[];
    return nonNull.length > 0 ? nonNull.reduce((a, b) => a + b, 0) : null;
  });
  const otherCurrentLiab = deriveValues(periods, (p) => {
    const i = periods.indexOf(p);
    const tcl = totalCurrentLiab[i];
    const known =
      (getVal(byPeriod, p, "SL_ACCOUNTS_PAYABLE") ?? 0) +
      (getVal(byPeriod, p, "SL_WAGES_PAYABLE") ?? 0) +
      (getVal(byPeriod, p, "SL_SHORT_TERM_DEBT") ?? 0);
    return tcl != null ? tcl - known : null;
  });

  // --- Non-Current Liabilities ---
  const mortgages = getVals(byPeriod, periods, "SL_MORTGAGES_NOTES_BONDS");
  const loansFromShareholders = getVals(byPeriod, periods, "SL_LOANS_FROM_SHAREHOLDERS");
  const otherLiabilities = getVals(byPeriod, periods, "SL_OTHER_LIABILITIES");

  // --- Equity ---
  const capitalStock = getVals(byPeriod, periods, "SL_CAPITAL_STOCK");
  const retainedEarnings = getVals(byPeriod, periods, "SL_RETAINED_EARNINGS");

  // S-corp fallback: retained earnings = total equity
  const totalEquity = deriveValues(periods, (p) => {
    const direct = getVal(byPeriod, p, "SL_TOTAL_EQUITY");
    if (direct != null) return direct;
    return getVal(byPeriod, p, "SL_RETAINED_EARNINGS");
  });

  // Derive total liabilities when not directly stored
  const totalLiabilities = deriveValues(periods, (p) => {
    const direct = getVal(byPeriod, p, "SL_TOTAL_LIABILITIES");
    if (direct != null) return direct;
    const ta = getVal(byPeriod, p, "SL_TOTAL_ASSETS");
    const eq = totalEquity[periods.indexOf(p)];
    return ta != null && eq != null ? ta - eq : null;
  });

  const totalNonCurrentLiab = deriveValues(periods, (p) => {
    const i = periods.indexOf(p);
    const tl = totalLiabilities[i];
    const tcl = totalCurrentLiab[i];
    return tl != null && tcl != null ? tl - tcl : null;
  });

  const workingCapital = sub(totalCurrentAssets, totalCurrentLiab);
  const tangNetWorth = deriveValues(periods, (p) => {
    const eq = totalEquity[periods.indexOf(p)];
    const intg = intangiblesNet[periods.indexOf(p)] ?? 0;
    return eq != null ? eq - intg : null;
  });

  const rows: FinancialRow[] = [
    // -- Current Assets --
    { label: "CURRENT ASSETS", indent: 0, isBold: true, values: periods.map(() => null), showPct: false },
    { label: "Cash & Equivalents", indent: 1, isBold: false, values: cash, showPct: true, pctBase: totalAssets },
    { label: "Accounts Receivable (Gross)", indent: 1, isBold: false, values: ar, showPct: true, pctBase: totalAssets },
    { label: "Less: Allowance for Bad Debts", indent: 2, isBold: false, values: arAllowance, showPct: true, pctBase: totalAssets, isNegative: true },
    { label: "Net Accounts Receivable", indent: 1, isBold: false, values: netAr, showPct: true, pctBase: totalAssets },
    { label: "Inventory", indent: 1, isBold: false, values: inventory, showPct: true, pctBase: totalAssets },
    { label: "U.S. Gov Obligations", indent: 1, isBold: false, values: usGov, showPct: true, pctBase: totalAssets },
    { label: "Tax-Exempt Securities", indent: 1, isBold: false, values: taxExempt, showPct: true, pctBase: totalAssets },
    { label: "Other Current Assets", indent: 1, isBold: false, values: otherCA, showPct: true, pctBase: totalAssets },
    { label: "TOTAL CURRENT ASSETS", indent: 0, isBold: true, values: totalCurrentAssets, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    // -- Non-Current Assets --
    { label: "NON-CURRENT ASSETS", indent: 0, isBold: true, values: periods.map(() => null), showPct: false },
    { label: "Loans to Shareholders / Officers", indent: 1, isBold: false, values: officerLoansRcv, showPct: true, pctBase: totalAssets },
    { label: "Mortgage & Real Estate Loans", indent: 1, isBold: false, values: mortgageLoans, showPct: true, pctBase: totalAssets },
    { label: "Other Investments", indent: 1, isBold: false, values: otherInvestments, showPct: true, pctBase: totalAssets },
    { label: "Buildings & Depreciable Assets", indent: 1, isBold: false, values: ppeGross, showPct: true, pctBase: totalAssets },
    { label: "Less: Accum Depreciation", indent: 2, isBold: false, values: accumDepr, showPct: true, pctBase: totalAssets, isNegative: true },
    { label: "Net Fixed Assets", indent: 1, isBold: false, values: netFixed, showPct: true, pctBase: totalAssets },
    { label: "Depletable Assets", indent: 1, isBold: false, values: depletable, showPct: true, pctBase: totalAssets },
    { label: "Land", indent: 1, isBold: false, values: land, showPct: true, pctBase: totalAssets },
    { label: "Intangible Assets (Gross)", indent: 1, isBold: false, values: intangiblesGross, showPct: true, pctBase: totalAssets },
    { label: "Less: Accum Amortization", indent: 2, isBold: false, values: accumAmort, showPct: true, pctBase: totalAssets, isNegative: true },
    { label: "Net Intangibles", indent: 1, isBold: false, values: intangiblesNet, showPct: true, pctBase: totalAssets },
    { label: "Other Assets", indent: 1, isBold: false, values: otherAssets, showPct: true, pctBase: totalAssets },
    { label: "TOTAL NON-CURRENT ASSETS", indent: 0, isBold: true, values: totalNonCurrentAssets, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    { label: "TOTAL ASSETS", indent: 0, isBold: true, values: totalAssets, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    // -- Current Liabilities --
    { label: "CURRENT LIABILITIES", indent: 0, isBold: true, values: periods.map(() => null), showPct: false },
    { label: "Accounts Payable (Trade)", indent: 1, isBold: false, values: ap, showPct: true, pctBase: totalAssets },
    { label: "Wages Payable", indent: 1, isBold: false, values: wagesPayable, showPct: true, pctBase: totalAssets },
    { label: "Short-Term Debt", indent: 1, isBold: false, values: shortTermDebt, showPct: true, pctBase: totalAssets },
    { label: "Other Current Liabilities", indent: 1, isBold: false, values: otherCurrentLiab, showPct: true, pctBase: totalAssets },
    { label: "TOTAL CURRENT LIABILITIES", indent: 0, isBold: true, values: totalCurrentLiab, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    // -- Non-Current Liabilities --
    { label: "NON-CURRENT LIABILITIES", indent: 0, isBold: true, values: periods.map(() => null), showPct: false },
    { label: "Mortgages / Notes / Bonds", indent: 1, isBold: false, values: mortgages, showPct: true, pctBase: totalAssets },
    { label: "Loans from Shareholders", indent: 1, isBold: false, values: loansFromShareholders, showPct: true, pctBase: totalAssets },
    { label: "Other Liabilities", indent: 1, isBold: false, values: otherLiabilities, showPct: true, pctBase: totalAssets },
    { label: "TOTAL NON-CURRENT LIABILITIES", indent: 0, isBold: true, values: totalNonCurrentLiab, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    { label: "TOTAL LIABILITIES", indent: 0, isBold: true, values: totalLiabilities, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    // -- Net Worth --
    { label: "NET WORTH", indent: 0, isBold: true, values: periods.map(() => null), showPct: false },
    { label: "Capital Stock", indent: 1, isBold: false, values: capitalStock, showPct: true, pctBase: totalAssets },
    { label: "Retained Earnings", indent: 1, isBold: false, values: retainedEarnings, showPct: true, pctBase: totalAssets },
    { label: "TOTAL NET WORTH", indent: 0, isBold: true, values: totalEquity, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    { label: "TOTAL LIABILITIES & NET WORTH", indent: 0, isBold: true, values: totalAssets, showPct: true, pctBase: totalAssets },
    // Memo items
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    { label: "Working Capital", indent: 1, isBold: false, values: workingCapital, showPct: false },
    { label: "Tangible Net Worth", indent: 1, isBold: false, values: tangNetWorth, showPct: false },
  ];

  return rows;
}

function buildIncomeStatementRows(
  byPeriod: Map<string, Map<string, number | null>>,
  periods: string[],
): FinancialRow[] {
  const revenue = getValsFallback(byPeriod, periods, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME");
  const cogs = getVals(byPeriod, periods, "COST_OF_GOODS_SOLD");
  const grossProfit = getValsFallback(byPeriod, periods, "GROSS_PROFIT");
  const effectiveGrossProfit = grossProfit.map((v, i) => {
    if (v != null) return v;
    return revenue[i] != null ? revenue[i]! - (cogs[i] ?? 0) : null;
  });

  // --- Detailed Operating Expenses ---
  const officerComp = getVals(byPeriod, periods, "OFFICER_COMPENSATION");
  const salariesWages = getValsFallback(byPeriod, periods, "SALARIES_WAGES", "SALARIES_WAGES_IS");
  const rentExpense = getValsFallback(byPeriod, periods, "RENT_EXPENSE", "RENT_EXPENSE_IS");
  const repairsMaint = getValsFallback(byPeriod, periods, "REPAIRS_MAINTENANCE", "REPAIRS_MAINTENANCE_IS");
  const badDebt = getValsFallback(byPeriod, periods, "BAD_DEBT_EXPENSE", "BAD_DEBT_EXPENSE_IS");
  const taxesLicenses = getVals(byPeriod, periods, "TAXES_LICENSES");
  const depreciation = getVals(byPeriod, periods, "DEPRECIATION");
  const amortization = getVals(byPeriod, periods, "AMORTIZATION");
  const interestExpense = getVals(byPeriod, periods, "INTEREST_EXPENSE");
  const advertising = getValsFallback(byPeriod, periods, "ADVERTISING", "ADVERTISING_IS");
  const pensionProfitSharing = getVals(byPeriod, periods, "PENSION_PROFIT_SHARING");
  const employeeBenefits = getVals(byPeriod, periods, "EMPLOYEE_BENEFITS");
  const insuranceExpense = getValsFallback(byPeriod, periods, "INSURANCE_EXPENSE", "INSURANCE_EXPENSE_IS");
  const otherDeductions = getValsFallback(byPeriod, periods, "OTHER_DEDUCTIONS", "OTHER_DEDUCTIONS_IS", "OTHER_OPERATING_EXPENSES_IS");

  // Helper: first non-null value across key variants for a single period
  const getFirstVal = (p: string, ...keys: string[]): number | null => {
    for (const k of keys) {
      const v = getVal(byPeriod, p, k);
      if (v != null) return v;
    }
    return null;
  };

  const totalOpex = deriveValues(periods, (p) => {
    const direct = getVal(byPeriod, p, "TOTAL_OPERATING_EXPENSES") ?? getVal(byPeriod, p, "TOTAL_DEDUCTIONS");
    if (direct != null) return direct;
    const sum =
      (getVal(byPeriod, p, "OFFICER_COMPENSATION") ?? 0) +
      (getFirstVal(p, "SALARIES_WAGES", "SALARIES_WAGES_IS") ?? 0) +
      (getFirstVal(p, "RENT_EXPENSE", "RENT_EXPENSE_IS") ?? 0) +
      (getFirstVal(p, "REPAIRS_MAINTENANCE", "REPAIRS_MAINTENANCE_IS") ?? 0) +
      (getFirstVal(p, "BAD_DEBT_EXPENSE", "BAD_DEBT_EXPENSE_IS") ?? 0) +
      (getVal(byPeriod, p, "TAXES_LICENSES") ?? 0) +
      (getVal(byPeriod, p, "DEPRECIATION") ?? 0) +
      (getVal(byPeriod, p, "AMORTIZATION") ?? 0) +
      (getVal(byPeriod, p, "INTEREST_EXPENSE") ?? 0) +
      (getFirstVal(p, "ADVERTISING", "ADVERTISING_IS") ?? 0) +
      (getVal(byPeriod, p, "PENSION_PROFIT_SHARING") ?? 0) +
      (getVal(byPeriod, p, "EMPLOYEE_BENEFITS") ?? 0) +
      (getFirstVal(p, "INSURANCE_EXPENSE", "INSURANCE_EXPENSE_IS") ?? 0) +
      (getFirstVal(p, "OTHER_DEDUCTIONS", "OTHER_DEDUCTIONS_IS", "OTHER_OPERATING_EXPENSES_IS") ?? 0);
    return sum > 0 ? sum : null;
  });

  const otherOpex = deriveValues(periods, (p) => {
    const i = periods.indexOf(p);
    const tot = totalOpex[i];
    const known =
      (getVal(byPeriod, p, "OFFICER_COMPENSATION") ?? 0) +
      (getFirstVal(p, "SALARIES_WAGES", "SALARIES_WAGES_IS") ?? 0) +
      (getFirstVal(p, "RENT_EXPENSE", "RENT_EXPENSE_IS") ?? 0) +
      (getFirstVal(p, "REPAIRS_MAINTENANCE", "REPAIRS_MAINTENANCE_IS") ?? 0) +
      (getFirstVal(p, "BAD_DEBT_EXPENSE", "BAD_DEBT_EXPENSE_IS") ?? 0) +
      (getVal(byPeriod, p, "TAXES_LICENSES") ?? 0) +
      (getVal(byPeriod, p, "DEPRECIATION") ?? 0) +
      (getVal(byPeriod, p, "AMORTIZATION") ?? 0) +
      (getVal(byPeriod, p, "INTEREST_EXPENSE") ?? 0) +
      (getFirstVal(p, "ADVERTISING", "ADVERTISING_IS") ?? 0) +
      (getVal(byPeriod, p, "PENSION_PROFIT_SHARING") ?? 0) +
      (getVal(byPeriod, p, "EMPLOYEE_BENEFITS") ?? 0) +
      (getFirstVal(p, "INSURANCE_EXPENSE", "INSURANCE_EXPENSE_IS") ?? 0) +
      (getFirstVal(p, "OTHER_DEDUCTIONS", "OTHER_DEDUCTIONS_IS", "OTHER_OPERATING_EXPENSES_IS") ?? 0);
    return tot != null && tot > known ? tot - known : null;
  });

  const netOpProfit = deriveValues(periods, (p) => {
    const oi = getVal(byPeriod, p, "OPERATING_INCOME");
    if (oi != null) return oi;
    const i = periods.indexOf(p);
    const gp = effectiveGrossProfit[i];
    const opex = totalOpex[i];
    return gp != null && opex != null ? gp - opex : null;
  });

  // --- Below the line ---
  const otherIncome = getVals(byPeriod, periods, "OTHER_INCOME");
  const netIncome = getValsFallback(byPeriod, periods, "NET_INCOME", "ORDINARY_BUSINESS_INCOME");
  const distributions = getVals(byPeriod, periods, "DISTRIBUTIONS");

  const ebit = deriveValues(periods, (p) => {
    const ni = getVal(byPeriod, p, "NET_INCOME") ?? getVal(byPeriod, p, "ORDINARY_BUSINESS_INCOME");
    const ie = getVal(byPeriod, p, "INTEREST_EXPENSE") ?? 0;
    return ni != null ? ni + ie : null;
  });

  const depAmort = deriveValues(periods, (p) => {
    const dep = getVal(byPeriod, p, "DEPRECIATION") ?? 0;
    const amort = getVal(byPeriod, p, "AMORTIZATION") ?? 0;
    return dep + amort > 0 ? dep + amort : null;
  });

  const ebitda = deriveValues(periods, (p) => {
    const ni = getVal(byPeriod, p, "NET_INCOME") ?? getVal(byPeriod, p, "ORDINARY_BUSINESS_INCOME");
    const ie = getVal(byPeriod, p, "INTEREST_EXPENSE") ?? 0;
    const dep = getVal(byPeriod, p, "DEPRECIATION") ?? 0;
    const amort = getVal(byPeriod, p, "AMORTIZATION") ?? 0;
    return ni != null ? ni + ie + dep + amort : null;
  });

  const rows: FinancialRow[] = [
    { label: "Sales / Revenues", indent: 0, isBold: true, values: revenue, showPct: true, pctBase: revenue },
    { label: "Cost of Goods Sold", indent: 1, isBold: false, values: cogs, showPct: true, pctBase: revenue },
    { label: "GROSS PROFIT", indent: 0, isBold: true, values: effectiveGrossProfit, showPct: true, pctBase: revenue },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    // Operating Expenses
    { label: "OPERATING EXPENSES", indent: 0, isBold: true, values: periods.map(() => null), showPct: false },
    { label: "Officers' Compensation", indent: 1, isBold: false, values: officerComp, showPct: true, pctBase: revenue },
    { label: "Salaries & Wages", indent: 1, isBold: false, values: salariesWages, showPct: true, pctBase: revenue },
    { label: "Rent Expense", indent: 1, isBold: false, values: rentExpense, showPct: true, pctBase: revenue },
    { label: "Repairs & Maintenance", indent: 1, isBold: false, values: repairsMaint, showPct: true, pctBase: revenue },
    { label: "Bad Debt Expense", indent: 1, isBold: false, values: badDebt, showPct: true, pctBase: revenue },
    { label: "Taxes & Licenses", indent: 1, isBold: false, values: taxesLicenses, showPct: true, pctBase: revenue },
    { label: "Depreciation", indent: 1, isBold: false, values: depreciation, showPct: true, pctBase: revenue },
    { label: "Amortization", indent: 1, isBold: false, values: amortization, showPct: true, pctBase: revenue },
    { label: "Interest Expense", indent: 1, isBold: false, values: interestExpense, showPct: true, pctBase: revenue },
    { label: "Advertising", indent: 1, isBold: false, values: advertising, showPct: true, pctBase: revenue },
    { label: "Pension & Profit Sharing", indent: 1, isBold: false, values: pensionProfitSharing, showPct: true, pctBase: revenue },
    { label: "Employee Benefits", indent: 1, isBold: false, values: employeeBenefits, showPct: true, pctBase: revenue },
    { label: "Insurance", indent: 1, isBold: false, values: insuranceExpense, showPct: true, pctBase: revenue },
    { label: "Other Deductions", indent: 1, isBold: false, values: otherDeductions, showPct: true, pctBase: revenue },
    { label: "Other Operating Expense", indent: 1, isBold: false, values: otherOpex, showPct: true, pctBase: revenue },
    { label: "TOTAL OPERATING EXPENSE", indent: 0, isBold: true, values: totalOpex, showPct: true, pctBase: revenue },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    { label: "NET OPERATING PROFIT", indent: 0, isBold: true, values: netOpProfit, showPct: true, pctBase: revenue },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    // Below the line
    { label: "Other Income / (Expense)", indent: 1, isBold: false, values: otherIncome, showPct: true, pctBase: revenue },
    { label: "NET PROFIT", indent: 0, isBold: true, values: netIncome, showPct: true, pctBase: revenue },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    { label: "Distributions", indent: 1, isBold: false, values: distributions, showPct: true, pctBase: revenue },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    { label: "EBIT", indent: 1, isBold: false, values: ebit, showPct: true, pctBase: revenue },
    { label: "Dep & Amort", indent: 1, isBold: false, values: depAmort, showPct: true, pctBase: revenue },
    { label: "EBITDA", indent: 0, isBold: true, values: ebitda, showPct: true, pctBase: revenue },
  ];

  return rows;
}

// ---------------------------------------------------------------------------
// UCA Cash Flow (indirect method)
// ---------------------------------------------------------------------------

function buildCashFlowRows(
  byPeriod: Map<string, Map<string, number | null>>,
  periods: string[],
): CashFlowRow[] {
  // Need at least 2 periods for delta-based items
  if (periods.length < 2) return [];

  const rows: CashFlowRow[] = [];

  // --- Net Income ---
  const netIncome = periods.map((p) =>
    getVal(byPeriod, p, "NET_INCOME") ?? getVal(byPeriod, p, "ORDINARY_BUSINESS_INCOME"),
  );

  rows.push({ label: "Net Income", indent: 0, isBold: true, values: netIncome });

  // --- Non-cash adjustments ---
  rows.push({ label: "ADJUSTMENTS", indent: 0, isBold: true, values: periods.map(() => null) });

  const depreciation = periods.map((p) => getVal(byPeriod, p, "DEPRECIATION"));
  const amortization = periods.map((p) => getVal(byPeriod, p, "AMORTIZATION"));
  const totalDA = periods.map((_, i) => {
    const d = depreciation[i] ?? 0;
    const a = amortization[i] ?? 0;
    return d + a > 0 ? d + a : null;
  });

  rows.push({ label: "Depreciation & Amortization", indent: 1, isBold: false, values: totalDA });

  // --- Working capital changes (delta = prior - current for assets, current - prior for liabilities) ---
  rows.push({ label: "CHANGES IN WORKING CAPITAL", indent: 0, isBold: true, values: periods.map(() => null) });

  function delta(key: string, invert: boolean): (number | null)[] {
    return periods.map((p, i) => {
      if (i === 0) return null; // no prior period
      const cur = getVal(byPeriod, p, key);
      const prev = getVal(byPeriod, periods[i - 1]!, key);
      if (cur == null || prev == null) return null;
      // For assets: decrease = source of cash (prior - current)
      // For liabilities: increase = source of cash (current - prior)
      return invert ? cur - prev : prev - cur;
    });
  }

  const dAR = delta("SL_AR_GROSS", false); // asset: decrease = cash in
  const dInventory = delta("SL_INVENTORY", false);
  const dOtherCA = delta("SL_OTHER_CURRENT_ASSETS", false);
  const dAP = delta("SL_ACCOUNTS_PAYABLE", true); // liability: increase = cash in
  const dWagesPayable = delta("SL_WAGES_PAYABLE", true);
  const dOtherCL = delta("SL_OTHER_LIABILITIES", true);

  rows.push({ label: "(Inc) / Dec in Accounts Receivable", indent: 1, isBold: false, values: dAR });
  rows.push({ label: "(Inc) / Dec in Inventory", indent: 1, isBold: false, values: dInventory });
  rows.push({ label: "(Inc) / Dec in Other Current Assets", indent: 1, isBold: false, values: dOtherCA });
  rows.push({ label: "Inc / (Dec) in Accounts Payable", indent: 1, isBold: false, values: dAP });
  rows.push({ label: "Inc / (Dec) in Wages Payable", indent: 1, isBold: false, values: dWagesPayable });
  rows.push({ label: "Inc / (Dec) in Other Liabilities", indent: 1, isBold: false, values: dOtherCL });

  // Total working capital change
  const wcChange = periods.map((_, i) => {
    if (i === 0) return null;
    const items = [dAR[i], dInventory[i], dOtherCA[i], dAP[i], dWagesPayable[i], dOtherCL[i]];
    const nonNull = items.filter((v) => v != null) as number[];
    return nonNull.length > 0 ? nonNull.reduce((a, b) => a + b, 0) : null;
  });
  rows.push({ label: "NET WORKING CAPITAL CHANGE", indent: 0, isBold: true, values: wcChange });

  // --- Cash from Operations (UCA CFO) ---
  const cfo = periods.map((_, i) => {
    const ni = netIncome[i];
    const da = totalDA[i] ?? 0;
    const wc = wcChange[i] ?? 0;
    return ni != null ? ni + da + wc : null;
  });
  rows.push({ label: "", indent: 0, isBold: false, values: periods.map(() => null) });
  rows.push({ label: "CASH FROM OPERATIONS (UCA)", indent: 0, isBold: true, values: cfo });

  // --- Capital Expenditures (change in gross PP&E) ---
  const capex = periods.map((p, i) => {
    if (i === 0) return null;
    const cur = getVal(byPeriod, p, "SL_PPE_GROSS");
    const prev = getVal(byPeriod, periods[i - 1]!, "SL_PPE_GROSS");
    if (cur == null || prev == null) return null;
    return -(cur - prev); // negative = cash outflow
  });
  rows.push({ label: "Capital Expenditures", indent: 1, isBold: false, values: capex, isNegative: true });

  // Net Cash After CapEx
  const netCashAfterCapex = periods.map((_, i) => {
    const c = cfo[i];
    const cx = capex[i] ?? 0;
    return c != null ? c + cx : null;
  });
  rows.push({ label: "NET CASH AFTER CAPEX", indent: 0, isBold: true, values: netCashAfterCapex });

  // --- Distributions ---
  const distributions = periods.map((p) => getVal(byPeriod, p, "DISTRIBUTIONS"));
  const distNeg = distributions.map((v) => (v != null ? -v : null));
  rows.push({ label: "Less: Distributions", indent: 1, isBold: false, values: distNeg, isNegative: true });

  // Cash Available for Debt Service
  const cashAvail = periods.map((_, i) => {
    const ncac = netCashAfterCapex[i];
    const dist = distNeg[i] ?? 0;
    return ncac != null ? ncac + dist : null;
  });
  rows.push({ label: "", indent: 0, isBold: false, values: periods.map(() => null) });
  rows.push({ label: "CASH AVAILABLE FOR DEBT SERVICE", indent: 0, isBold: true, values: cashAvail });

  return rows;
}

function buildRatioSections(
  byPeriod: Map<string, Map<string, number | null>>,
  periods: string[],
  cashFlowRows: CashFlowRow[],
): RatioSection[] {
  const g = (p: string, ...keys: string[]) => {
    for (const k of keys) {
      const v = getVal(byPeriod, p, k);
      if (v != null) return v;
    }
    return null;
  };

  function ratioVals(fn: (p: string, i: number) => number | string | null): (number | string | null)[] {
    return periods.map((p, i) => fn(p, i));
  }

  function safeDiv(a: number | null, b: number | null): number | string | null {
    if (a == null || b == null) return null;
    if (b === 0) return "N/A";
    if (b < 0) return "N/A";
    return a / b;
  }

  // Helper: get UCA CFO from cash flow rows
  function getCfo(periodIndex: number): number | null {
    const cfoRow = cashFlowRows.find((r) => r.label === "CASH FROM OPERATIONS (UCA)");
    return cfoRow?.values[periodIndex] ?? null;
  }

  // Helper: derive total equity with S-corp fallback
  function getEquity(p: string): number | null {
    return g(p, "SL_TOTAL_EQUITY") ?? g(p, "SL_RETAINED_EARNINGS");
  }

  // Helper: derive total liabilities
  function getLiabilities(p: string): number | null {
    const direct = g(p, "SL_TOTAL_LIABILITIES");
    if (direct != null) return direct;
    const ta = g(p, "SL_TOTAL_ASSETS");
    const eq = getEquity(p);
    return ta != null && eq != null ? ta - eq : null;
  }

  // Helper: derive total current assets
  function getTCA(p: string): number | null {
    return g(p, "TOTAL_CURRENT_ASSETS", "SL_TOTAL_CURRENT_ASSETS") ?? (() => {
      const components = [
        g(p, "SL_CASH"),
        (() => { const a = g(p, "SL_AR_GROSS"); return a != null ? a - (g(p, "SL_AR_ALLOWANCE") ?? 0) : null; })(),
        g(p, "SL_INVENTORY"),
        g(p, "SL_US_GOV_OBLIGATIONS"),
        g(p, "SL_TAX_EXEMPT_SECURITIES"),
        g(p, "SL_OTHER_CURRENT_ASSETS"),
      ].filter((v) => v != null) as number[];
      return components.length > 0 ? components.reduce((a, b) => a + b, 0) : null;
    })();
  }

  // Helper: derive total current liabilities
  function getTCL(p: string): number | null {
    return g(p, "TOTAL_CURRENT_LIABILITIES", "SL_TOTAL_CURRENT_LIABILITIES") ?? (() => {
      const components = [
        g(p, "SL_ACCOUNTS_PAYABLE"),
        g(p, "SL_WAGES_PAYABLE"),
        g(p, "SL_SHORT_TERM_DEBT"),
        g(p, "SL_OPERATING_CURRENT_LIABILITIES"),
      ].filter((v) => v != null) as number[];
      return components.length > 0 ? components.reduce((a, b) => a + b, 0) : null;
    })();
  }

  // Helper: derive total opex (with _IS suffix fallbacks for tax return data)
  function getOpex(p: string): number | null {
    const direct = g(p, "TOTAL_OPERATING_EXPENSES") ?? g(p, "TOTAL_DEDUCTIONS");
    if (direct != null) return direct;
    const sum =
      (g(p, "OFFICER_COMPENSATION") ?? 0) +
      (g(p, "SALARIES_WAGES", "SALARIES_WAGES_IS") ?? 0) +
      (g(p, "RENT_EXPENSE", "RENT_EXPENSE_IS") ?? 0) +
      (g(p, "REPAIRS_MAINTENANCE", "REPAIRS_MAINTENANCE_IS") ?? 0) +
      (g(p, "BAD_DEBT_EXPENSE", "BAD_DEBT_EXPENSE_IS") ?? 0) +
      (g(p, "TAXES_LICENSES") ?? 0) +
      (g(p, "DEPRECIATION") ?? 0) +
      (g(p, "AMORTIZATION") ?? 0) +
      (g(p, "INTEREST_EXPENSE") ?? 0) +
      (g(p, "ADVERTISING", "ADVERTISING_IS") ?? 0) +
      (g(p, "PENSION_PROFIT_SHARING") ?? 0) +
      (g(p, "EMPLOYEE_BENEFITS") ?? 0) +
      (g(p, "INSURANCE_EXPENSE", "INSURANCE_EXPENSE_IS") ?? 0) +
      (g(p, "OTHER_DEDUCTIONS", "OTHER_DEDUCTIONS_IS", "OTHER_OPERATING_EXPENSES_IS") ?? 0);
    return sum > 0 ? sum : null;
  }

  function yoyGrowth(keysFn: (p: string) => number | null): (number | string | null)[] {
    return periods.map((p, i) => {
      if (i === 0) return null;
      const cur = keysFn(p);
      const prev = keysFn(periods[i - 1]!);
      if (cur == null || prev == null || prev === 0) return null;
      return ((cur - prev) / Math.abs(prev)) * 100;
    });
  }

  const sections: RatioSection[] = [
    {
      title: "LIQUIDITY",
      rows: [
        {
          label: "Working Capital",
          values: ratioVals((p) => {
            const ca = getTCA(p);
            const cl = getTCL(p);
            return ca != null && cl != null ? ca - cl : null;
          }),
          format: "currency", decimals: 0,
        },
        {
          label: "Current Ratio",
          values: ratioVals((p) => safeDiv(getTCA(p), getTCL(p))),
          format: "ratio", decimals: 2,
        },
        {
          label: "Quick Ratio",
          values: ratioVals((p) => {
            const ca = getTCA(p);
            const inv = g(p, "SL_INVENTORY") ?? 0;
            const cl = getTCL(p);
            return ca != null && cl != null ? safeDiv(ca - inv, cl) : null;
          }),
          format: "ratio", decimals: 2,
        },
      ],
    },
    {
      title: "LEVERAGE",
      rows: [
        {
          label: "Net Worth",
          values: ratioVals((p) => getEquity(p)),
          format: "currency", decimals: 0,
        },
        {
          label: "Tangible Net Worth",
          values: ratioVals((p) => {
            const eq = getEquity(p);
            const intgGross = g(p, "SL_INTANGIBLES_GROSS") ?? 0;
            const intgAmort = g(p, "SL_ACCUMULATED_AMORTIZATION") ?? 0;
            const intg = intgGross - intgAmort;
            return eq != null ? eq - intg : null;
          }),
          format: "currency", decimals: 0,
        },
        {
          label: "Debt / Worth",
          values: ratioVals((p) => safeDiv(getLiabilities(p), getEquity(p))),
          format: "ratio", decimals: 2,
        },
        {
          label: "Debt / Tangible Net Worth",
          values: ratioVals((p) => {
            const tl = getLiabilities(p);
            const eq = getEquity(p);
            const intgGross = g(p, "SL_INTANGIBLES_GROSS") ?? 0;
            const intgAmort = g(p, "SL_ACCUMULATED_AMORTIZATION") ?? 0;
            const tnw = eq != null ? eq - (intgGross - intgAmort) : null;
            return safeDiv(tl, tnw);
          }),
          format: "ratio", decimals: 2,
        },
        {
          label: "Total Liabilities / Total Assets",
          values: ratioVals((p) => safeDiv(getLiabilities(p), g(p, "SL_TOTAL_ASSETS"))),
          format: "ratio", decimals: 2,
        },
      ],
    },
    {
      title: "COVERAGE",
      rows: [
        {
          label: "EBITDA",
          values: ratioVals((p) => {
            const ni = g(p, "NET_INCOME", "ORDINARY_BUSINESS_INCOME");
            if (ni == null) return null;
            return ni + (g(p, "INTEREST_EXPENSE") ?? 0) + (g(p, "DEPRECIATION") ?? 0) + (g(p, "AMORTIZATION") ?? 0);
          }),
          format: "currency", decimals: 0,
        },
        {
          label: "Interest Coverage",
          values: ratioVals((p) => {
            const ni = g(p, "NET_INCOME", "ORDINARY_BUSINESS_INCOME");
            const ie = g(p, "INTEREST_EXPENSE");
            if (ni == null || ie == null) return null;
            return safeDiv(ni + ie, ie);
          }),
          format: "ratio", decimals: 2,
        },
        {
          label: "DSCR (Traditional)",
          values: ratioVals((p) => {
            const ni = g(p, "NET_INCOME", "ORDINARY_BUSINESS_INCOME");
            const dep = g(p, "DEPRECIATION") ?? 0;
            const ie = g(p, "INTEREST_EXPENSE");
            if (ni == null || ie == null) return "N/A";
            if (ie === 0) return "N/A";
            return (ni + dep + ie) / ie;
          }),
          format: "ratio", decimals: 2,
        },
        {
          label: "UCA Cash Flow DSCR",
          values: ratioVals((_, i) => {
            const cfo = getCfo(i);
            const ie = g(periods[i]!, "INTEREST_EXPENSE");
            if (cfo == null || ie == null || ie === 0) return "N/A";
            return safeDiv(cfo, ie);
          }),
          format: "ratio", decimals: 2,
        },
      ],
    },
    {
      title: "PROFITABILITY",
      rows: [
        {
          label: "Gross Margin %",
          values: ratioVals((p) => {
            const rev = g(p, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME");
            const gp = g(p, "GROSS_PROFIT") ?? (rev != null ? rev - (g(p, "COST_OF_GOODS_SOLD") ?? 0) : null);
            if (rev == null || gp == null || rev === 0) return null;
            return (gp / rev) * 100;
          }),
          format: "percent", decimals: 1,
        },
        {
          label: "Operating Profit Margin %",
          values: ratioVals((p) => {
            const rev = g(p, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME");
            if (rev == null || rev === 0) return null;
            const gp = g(p, "GROSS_PROFIT") ?? (rev - (g(p, "COST_OF_GOODS_SOLD") ?? 0));
            const opex = getOpex(p);
            if (opex == null) return null;
            return ((gp - opex) / rev) * 100;
          }),
          format: "percent", decimals: 1,
        },
        {
          label: "Net Margin %",
          values: ratioVals((p) => {
            const rev = g(p, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME");
            const ni = g(p, "NET_INCOME", "ORDINARY_BUSINESS_INCOME");
            if (rev == null || ni == null || rev === 0) return null;
            return (ni / rev) * 100;
          }),
          format: "percent", decimals: 1,
        },
        {
          label: "Return on Assets %",
          values: ratioVals((p) => {
            const ni = g(p, "NET_INCOME", "ORDINARY_BUSINESS_INCOME");
            const ta = g(p, "SL_TOTAL_ASSETS");
            if (ni == null || ta == null || ta === 0) return null;
            return (ni / ta) * 100;
          }),
          format: "percent", decimals: 1,
        },
        {
          label: "Return on Equity %",
          values: ratioVals((p) => {
            const ni = g(p, "NET_INCOME", "ORDINARY_BUSINESS_INCOME");
            const eq = getEquity(p);
            if (ni == null || eq == null || eq === 0) return null;
            return (ni / eq) * 100;
          }),
          format: "percent", decimals: 1,
        },
      ],
    },
    {
      title: "ACTIVITY",
      rows: [
        {
          label: "AR Days",
          values: ratioVals((p) => {
            const ar = g(p, "SL_AR_GROSS");
            const rev = g(p, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME");
            if (ar == null || rev == null || rev === 0) return null;
            return (ar / rev) * 365;
          }),
          format: "days", decimals: 1,
        },
        {
          label: "AP Days",
          values: ratioVals((p) => {
            const ap = g(p, "SL_ACCOUNTS_PAYABLE");
            const cogs = g(p, "COST_OF_GOODS_SOLD");
            if (ap == null || cogs == null || cogs === 0) return null;
            return (ap / cogs) * 365;
          }),
          format: "days", decimals: 1,
        },
        {
          label: "Inventory Days",
          values: ratioVals((p) => {
            const inv = g(p, "SL_INVENTORY");
            const cogs = g(p, "COST_OF_GOODS_SOLD");
            if (inv == null || cogs == null || cogs === 0) return null;
            return (inv / cogs) * 365;
          }),
          format: "days", decimals: 1,
        },
        {
          label: "Net Sales / Total Assets",
          values: ratioVals((p) => safeDiv(g(p, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME"), g(p, "SL_TOTAL_ASSETS"))),
          format: "ratio", decimals: 2,
        },
        {
          label: "Net Sales / Net Worth",
          values: ratioVals((p) => safeDiv(g(p, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME"), getEquity(p))),
          format: "ratio", decimals: 2,
        },
      ],
    },
    {
      title: "GROWTH",
      rows: [
        {
          label: "Net Sales Growth %",
          values: yoyGrowth((p) => g(p, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME")),
          format: "percent", decimals: 1,
        },
        {
          label: "Net Profit Growth %",
          values: yoyGrowth((p) => g(p, "NET_INCOME", "ORDINARY_BUSINESS_INCOME")),
          format: "percent", decimals: 1,
        },
        {
          label: "Total Assets Growth %",
          values: yoyGrowth((p) => g(p, "SL_TOTAL_ASSETS")),
          format: "percent", decimals: 1,
        },
        {
          label: "Total Liabilities Growth %",
          values: yoyGrowth((p) => getLiabilities(p)),
          format: "percent", decimals: 1,
        },
        {
          label: "Net Worth Growth %",
          values: yoyGrowth((p) => getEquity(p)),
          format: "percent", decimals: 1,
        },
      ],
    },
  ];

  return sections;
}

function buildExecutiveSummary(
  byPeriod: Map<string, Map<string, number | null>>,
  periods: string[],
): ClassicSpreadInput["executiveSummary"] {
  const totalAssets = getVals(byPeriod, periods, "SL_TOTAL_ASSETS");
  const revenue = getValsFallback(byPeriod, periods, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME");

  // S-corp fallback: retained earnings = total equity when SL_TOTAL_EQUITY missing
  const totalEquity = deriveValues(periods, (p) => {
    const direct = getVal(byPeriod, p, "SL_TOTAL_EQUITY");
    if (direct != null) return direct;
    return getVal(byPeriod, p, "SL_RETAINED_EARNINGS");
  });

  // Derive total liabilities when not directly stored
  const totalLiabilities = deriveValues(periods, (p) => {
    const direct = getVal(byPeriod, p, "SL_TOTAL_LIABILITIES");
    if (direct != null) return direct;
    const ta = getVal(byPeriod, p, "SL_TOTAL_ASSETS");
    const eq = totalEquity[periods.indexOf(p)];
    return ta != null && eq != null ? ta - eq : null;
  });

  return {
    assets: [
      { label: "Cash & Equivalents", indent: 1, isBold: false, values: getVals(byPeriod, periods, "SL_CASH"), showPct: true, pctBase: totalAssets },
      { label: "Accounts Receivable", indent: 1, isBold: false, values: getVals(byPeriod, periods, "SL_AR_GROSS"), showPct: true, pctBase: totalAssets },
      { label: "Inventory", indent: 1, isBold: false, values: getVals(byPeriod, periods, "SL_INVENTORY"), showPct: true, pctBase: totalAssets },
      { label: "TOTAL CURRENT ASSETS", indent: 0, isBold: true, values: deriveValues(periods, (p) => {
        const direct = getVal(byPeriod, p, "TOTAL_CURRENT_ASSETS") ?? getVal(byPeriod, p, "SL_TOTAL_CURRENT_ASSETS");
        if (direct != null) return direct;
        const components = [
          getVal(byPeriod, p, "SL_CASH"),
          (() => { const a = getVal(byPeriod, p, "SL_AR_GROSS"); return a != null ? a - (getVal(byPeriod, p, "SL_AR_ALLOWANCE") ?? 0) : null; })(),
          getVal(byPeriod, p, "SL_INVENTORY"),
          getVal(byPeriod, p, "SL_US_GOV_OBLIGATIONS"),
          getVal(byPeriod, p, "SL_TAX_EXEMPT_SECURITIES"),
          getVal(byPeriod, p, "SL_OTHER_CURRENT_ASSETS"),
        ].filter((v) => v != null) as number[];
        return components.length > 0 ? components.reduce((a, b) => a + b, 0) : null;
      }), showPct: true, pctBase: totalAssets },
      { label: "Net Fixed Assets", indent: 1, isBold: false, values: deriveValues(periods, (p) => {
        const ppe = getVal(byPeriod, p, "SL_PPE_GROSS");
        return ppe != null ? ppe - (getVal(byPeriod, p, "SL_ACCUMULATED_DEPRECIATION") ?? 0) : null;
      }), showPct: true, pctBase: totalAssets },
      { label: "TOTAL ASSETS", indent: 0, isBold: true, values: totalAssets, showPct: true, pctBase: totalAssets },
    ],
    liabilitiesAndNetWorth: [
      { label: "TOTAL CURRENT LIABILITIES", indent: 0, isBold: true, values: deriveValues(periods, (p) => {
        const direct = getVal(byPeriod, p, "TOTAL_CURRENT_LIABILITIES") ?? getVal(byPeriod, p, "SL_TOTAL_CURRENT_LIABILITIES");
        if (direct != null) return direct;
        const components = [
          getVal(byPeriod, p, "SL_ACCOUNTS_PAYABLE"),
          getVal(byPeriod, p, "SL_WAGES_PAYABLE"),
          getVal(byPeriod, p, "SL_SHORT_TERM_DEBT"),
          getVal(byPeriod, p, "SL_OPERATING_CURRENT_LIABILITIES"),
        ].filter((v) => v != null) as number[];
        return components.length > 0 ? components.reduce((a, b) => a + b, 0) : null;
      }), showPct: true, pctBase: totalAssets },
      { label: "Long-Term Debt", indent: 1, isBold: false, values: getVals(byPeriod, periods, "SL_MORTGAGES_NOTES_BONDS"), showPct: true, pctBase: totalAssets },
      { label: "TOTAL LIABILITIES", indent: 0, isBold: true, values: totalLiabilities, showPct: true, pctBase: totalAssets },
      { label: "TOTAL NET WORTH", indent: 0, isBold: true, values: totalEquity, showPct: true, pctBase: totalAssets },
      { label: "TOTAL LIABILITIES & NET WORTH", indent: 0, isBold: true, values: totalAssets, showPct: true, pctBase: totalAssets },
    ],
    incomeStatement: [
      { label: "Sales / Revenues", indent: 0, isBold: true, values: revenue, showPct: true, pctBase: revenue },
      { label: "Cost of Goods Sold", indent: 1, isBold: false, values: getVals(byPeriod, periods, "COST_OF_GOODS_SOLD"), showPct: true, pctBase: revenue },
      { label: "GROSS PROFIT", indent: 0, isBold: true, values: getValsFallback(byPeriod, periods, "GROSS_PROFIT"), showPct: true, pctBase: revenue },
      { label: "TOTAL OPERATING EXPENSE", indent: 0, isBold: true, values: getVals(byPeriod, periods, "TOTAL_OPERATING_EXPENSES"), showPct: true, pctBase: revenue },
      { label: "NET PROFIT", indent: 0, isBold: true, values: getValsFallback(byPeriod, periods, "NET_INCOME", "ORDINARY_BUSINESS_INCOME"), showPct: true, pctBase: revenue },
      { label: "EBITDA", indent: 0, isBold: true, values: deriveValues(periods, (p) => {
        const ni = getVal(byPeriod, p, "NET_INCOME") ?? getVal(byPeriod, p, "ORDINARY_BUSINESS_INCOME");
        if (ni == null) return null;
        return ni + (getVal(byPeriod, p, "INTEREST_EXPENSE") ?? 0) + (getVal(byPeriod, p, "DEPRECIATION") ?? 0) + (getVal(byPeriod, p, "AMORTIZATION") ?? 0);
      }), showPct: true, pctBase: revenue },
    ],
  };
}

// ---------------------------------------------------------------------------
// Audit method derivation
// ---------------------------------------------------------------------------

function deriveAuditMethod(
  byPeriod: Map<string, Map<string, number | null>>,
  period: string,
): string {
  const m = byPeriod.get(period);
  if (!m) return "Company Prepared";
  if (m.has("BUSINESS_TAX_RETURN") || m.has("PERSONAL_TAX_RETURN")) return "Tax Return";
  if (m.has("INCOME_STATEMENT") || m.has("BALANCE_SHEET")) return "Company Prepared";
  return "Company Prepared";
}

// ---------------------------------------------------------------------------
// Main Loader
// ---------------------------------------------------------------------------

export async function loadClassicSpreadData(dealId: string): Promise<ClassicSpreadInput> {
  const sb = supabaseAdmin();

  const [factsRes, dealRes, bankRes] = await Promise.all([
    sb
      .from("deal_financial_facts")
      .select("fact_key, fact_period_end, fact_value_num, confidence, created_at")
      .eq("deal_id", dealId)
      .not("fact_value_num", "is", null),
    sb
      .from("deals")
      .select("id, name, borrower_name, bank_id")
      .eq("id", dealId)
      .maybeSingle(),
    // We'll get the bank name after we have the bank_id
    null as any,
  ]);

  if (factsRes.error) throw new Error(`facts_query_failed: ${factsRes.error.message}`);
  const deal = dealRes.data as { id: string; name: string | null; borrower_name: string | null; bank_id: string | null } | null;

  let bankName = "Bank";
  if (deal?.bank_id) {
    const { data: bank } = await sb
      .from("banks")
      .select("name")
      .eq("id", deal.bank_id)
      .maybeSingle();
    bankName = (bank as { name: string } | null)?.name ?? "Bank";
  }

  // Exclude sentinel EXTRACTION_HEARTBEAT facts:
  // - fact_key starting with "document:" are OCR anchor facts (not financial data)
  // - fact_period_end year < 2000 is a sentinel date (1900-01-01 used for heartbeats)
  const facts = ((factsRes.data ?? []) as RawFact[]).filter((f) => {
    if (f.fact_key?.startsWith("document:")) return false;
    if (f.fact_period_end) {
      const year = parseInt(f.fact_period_end.slice(0, 4), 10);
      if (!isNaN(year) && year < 2000) return false;
    }
    return true;
  });
  const { periods, byPeriod } = buildPeriodMaps(facts);
  const currentYear = new Date().getFullYear();

  const statementPeriods: StatementPeriod[] = periods.map((p) => {
    const auditMethod = deriveAuditMethod(byPeriod, p);
    return {
      date: formatPeriodDate(p),
      months: deriveMonths(p),
      auditMethod,
      stmtType: auditMethod === "Tax Return" ? "Annual" : (deriveMonths(p) === 12 ? "Annual" : "Interim"),
      label: derivePeriodLabel(p, currentYear),
    };
  });

  // Check if we have BS or IS data
  const hasBsData = periods.some((p) => getVal(byPeriod, p, "SL_TOTAL_ASSETS") != null);
  const hasIsData = periods.some((p) =>
    getVal(byPeriod, p, "GROSS_RECEIPTS") != null ||
    getVal(byPeriod, p, "TOTAL_REVENUE") != null ||
    getVal(byPeriod, p, "NET_INCOME") != null,
  );

  const now = new Date();
  const preparedDate = now.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + ", " + now.toLocaleDateString("en-US");

  const cashFlowRows = hasBsData && hasIsData ? buildCashFlowRows(byPeriod, periods) : [];
  // Cash flow periods exclude the first period (need prior for deltas)
  const cfPeriods = periods.length >= 2 ? statementPeriods : [];

  return {
    dealId,
    companyName: deal?.borrower_name ?? deal?.name ?? "Unknown Company",
    preparedDate,
    naicsCode: null,
    naicsDescription: null,
    bankName,
    periods: statementPeriods,
    balanceSheet: hasBsData ? buildBalanceSheetRows(byPeriod, periods) : [],
    incomeStatement: hasIsData ? buildIncomeStatementRows(byPeriod, periods) : [],
    cashFlow: cashFlowRows,
    cashFlowPeriods: cfPeriods,
    ratioSections: buildRatioSections(byPeriod, periods, cashFlowRows),
    executiveSummary: buildExecutiveSummary(byPeriod, periods),
  };
}
