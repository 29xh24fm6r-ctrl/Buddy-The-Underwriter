import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
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

  const cash = getVals(byPeriod, periods, "SL_CASH");
  const ar = getVals(byPeriod, periods, "SL_AR_GROSS");
  const inventory = getVals(byPeriod, periods, "SL_INVENTORY");
  const totalCurrentAssets = getValsFallback(byPeriod, periods, "TOTAL_CURRENT_ASSETS", "SL_TOTAL_CURRENT_ASSETS");
  const otherCurrentAssets = deriveValues(periods, (p) => {
    const tca = getVal(byPeriod, p, "TOTAL_CURRENT_ASSETS") ?? getVal(byPeriod, p, "SL_TOTAL_CURRENT_ASSETS");
    const known =
      (getVal(byPeriod, p, "SL_CASH") ?? 0) +
      (getVal(byPeriod, p, "SL_AR_GROSS") ?? 0) +
      (getVal(byPeriod, p, "SL_INVENTORY") ?? 0);
    return tca != null ? tca - known : null;
  });

  const ppeGross = getVals(byPeriod, periods, "SL_PPE_GROSS");
  const accumDepr = getVals(byPeriod, periods, "SL_ACCUMULATED_DEPRECIATION");
  const netFixed = deriveValues(periods, (p) => {
    const ppe = getVal(byPeriod, p, "SL_PPE_GROSS");
    const dep = getVal(byPeriod, p, "SL_ACCUMULATED_DEPRECIATION");
    return ppe != null ? ppe - (dep ?? 0) : null;
  });
  const intangibles = getVals(byPeriod, periods, "SL_INTANGIBLES_NET");
  const totalNonCurrentAssets = deriveValues(periods, (p) => {
    const ta = getVal(byPeriod, p, "SL_TOTAL_ASSETS");
    const tca = getVal(byPeriod, p, "TOTAL_CURRENT_ASSETS") ?? getVal(byPeriod, p, "SL_TOTAL_CURRENT_ASSETS");
    return ta != null && tca != null ? ta - tca : null;
  });

  const ap = getVals(byPeriod, periods, "SL_ACCOUNTS_PAYABLE");
  const shortTermDebt = getVals(byPeriod, periods, "SL_SHORT_TERM_DEBT");
  const totalCurrentLiab = getValsFallback(byPeriod, periods, "TOTAL_CURRENT_LIABILITIES", "SL_TOTAL_CURRENT_LIABILITIES");
  const otherCurrentLiab = deriveValues(periods, (p) => {
    const tcl = getVal(byPeriod, p, "TOTAL_CURRENT_LIABILITIES") ?? getVal(byPeriod, p, "SL_TOTAL_CURRENT_LIABILITIES");
    const known =
      (getVal(byPeriod, p, "SL_ACCOUNTS_PAYABLE") ?? 0) +
      (getVal(byPeriod, p, "SL_SHORT_TERM_DEBT") ?? 0);
    return tcl != null ? tcl - known : null;
  });

  const mortgages = getVals(byPeriod, periods, "SL_MORTGAGES_NOTES_BONDS");
  const totalLiabilities = getVals(byPeriod, periods, "SL_TOTAL_LIABILITIES");
  const totalNonCurrentLiab = deriveValues(periods, (p) => {
    const tl = getVal(byPeriod, p, "SL_TOTAL_LIABILITIES");
    const tcl = getVal(byPeriod, p, "TOTAL_CURRENT_LIABILITIES") ?? getVal(byPeriod, p, "SL_TOTAL_CURRENT_LIABILITIES");
    return tl != null && tcl != null ? tl - tcl : null;
  });

  const commonStock = getVals(byPeriod, periods, "SL_COMMON_STOCK");
  const paidInCapital = getVals(byPeriod, periods, "SL_PAID_IN_CAPITAL");
  const retainedEarnings = getVals(byPeriod, periods, "SL_RETAINED_EARNINGS");
  const totalEquity = getVals(byPeriod, periods, "SL_TOTAL_EQUITY");

  const workingCapital = sub(totalCurrentAssets, totalCurrentLiab);
  const tangNetWorth = deriveValues(periods, (p) => {
    const eq = getVal(byPeriod, p, "SL_TOTAL_EQUITY");
    const intg = getVal(byPeriod, p, "SL_INTANGIBLES_NET") ?? 0;
    return eq != null ? eq - intg : null;
  });

  const rows: FinancialRow[] = [
    { label: "CURRENT ASSETS", indent: 0, isBold: true, values: periods.map(() => null), showPct: false },
    { label: "Cash & Equivalents", indent: 1, isBold: false, values: cash, showPct: true, pctBase: totalAssets },
    { label: "Accounts Receivable (Net)", indent: 1, isBold: false, values: ar, showPct: true, pctBase: totalAssets },
    { label: "Inventory", indent: 1, isBold: false, values: inventory, showPct: true, pctBase: totalAssets },
    { label: "Other Current Assets", indent: 1, isBold: false, values: otherCurrentAssets, showPct: true, pctBase: totalAssets },
    { label: "TOTAL CURRENT ASSETS", indent: 0, isBold: true, values: totalCurrentAssets, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false }, // spacer
    { label: "NON-CURRENT ASSETS", indent: 0, isBold: true, values: periods.map(() => null), showPct: false },
    { label: "Property, Plant & Equipment", indent: 1, isBold: false, values: ppeGross, showPct: true, pctBase: totalAssets },
    { label: "Accum Depreciation", indent: 1, isBold: false, values: accumDepr, showPct: true, pctBase: totalAssets, isNegative: true },
    { label: "Net Fixed Assets", indent: 1, isBold: false, values: netFixed, showPct: true, pctBase: totalAssets },
    { label: "Intangibles - Net", indent: 1, isBold: false, values: intangibles, showPct: true, pctBase: totalAssets },
    { label: "TOTAL NON-CURRENT ASSETS", indent: 0, isBold: true, values: totalNonCurrentAssets, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false }, // spacer
    { label: "TOTAL ASSETS", indent: 0, isBold: true, values: totalAssets, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false }, // spacer
    { label: "CURRENT LIABILITIES", indent: 0, isBold: true, values: periods.map(() => null), showPct: false },
    { label: "Accounts Payable", indent: 1, isBold: false, values: ap, showPct: true, pctBase: totalAssets },
    { label: "Short-Term Debt", indent: 1, isBold: false, values: shortTermDebt, showPct: true, pctBase: totalAssets },
    { label: "Other Current Liabilities", indent: 1, isBold: false, values: otherCurrentLiab, showPct: true, pctBase: totalAssets },
    { label: "TOTAL CURRENT LIABILITIES", indent: 0, isBold: true, values: totalCurrentLiab, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false }, // spacer
    { label: "NON-CURRENT LIABILITIES", indent: 0, isBold: true, values: periods.map(() => null), showPct: false },
    { label: "Mortgages / Notes Payable", indent: 1, isBold: false, values: mortgages, showPct: true, pctBase: totalAssets },
    { label: "TOTAL NON-CURRENT LIABILITIES", indent: 0, isBold: true, values: totalNonCurrentLiab, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false }, // spacer
    { label: "TOTAL LIABILITIES", indent: 0, isBold: true, values: totalLiabilities, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false }, // spacer
    { label: "NET WORTH", indent: 0, isBold: true, values: periods.map(() => null), showPct: false },
    { label: "Common Stock", indent: 1, isBold: false, values: commonStock, showPct: true, pctBase: totalAssets },
    { label: "Paid-In Capital", indent: 1, isBold: false, values: paidInCapital, showPct: true, pctBase: totalAssets },
    { label: "Retained Earnings", indent: 1, isBold: false, values: retainedEarnings, showPct: true, pctBase: totalAssets },
    { label: "TOTAL NET WORTH", indent: 0, isBold: true, values: totalEquity, showPct: true, pctBase: totalAssets },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false }, // spacer
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
  // Fallback: derive gross profit = revenue - cogs
  const effectiveGrossProfit = grossProfit.map((v, i) => {
    if (v != null) return v;
    return revenue[i] != null ? revenue[i]! - (cogs[i] ?? 0) : null;
  });

  const officerComp = getVals(byPeriod, periods, "OFFICER_COMPENSATION");
  const depreciation = getVals(byPeriod, periods, "DEPRECIATION");
  const interestExpense = getVals(byPeriod, periods, "INTEREST_EXPENSE");
  const totalOpex = getVals(byPeriod, periods, "TOTAL_OPERATING_EXPENSES");
  const otherOpex = deriveValues(periods, (p) => {
    const tot = getVal(byPeriod, p, "TOTAL_OPERATING_EXPENSES");
    const known =
      (getVal(byPeriod, p, "OFFICER_COMPENSATION") ?? 0) +
      (getVal(byPeriod, p, "DEPRECIATION") ?? 0) +
      (getVal(byPeriod, p, "INTEREST_EXPENSE") ?? 0);
    return tot != null ? tot - known : null;
  });

  const operatingIncome = getValsFallback(byPeriod, periods, "OPERATING_INCOME");
  const netOpProfit = deriveValues(periods, (p) => {
    const oi = getVal(byPeriod, p, "OPERATING_INCOME");
    if (oi != null) return oi;
    const gp = getVal(byPeriod, p, "GROSS_PROFIT") ??
      ((getVal(byPeriod, p, "GROSS_RECEIPTS") ?? getVal(byPeriod, p, "TOTAL_REVENUE") ?? getVal(byPeriod, p, "TOTAL_INCOME")) != null
        ? (getVal(byPeriod, p, "GROSS_RECEIPTS") ?? getVal(byPeriod, p, "TOTAL_REVENUE") ?? getVal(byPeriod, p, "TOTAL_INCOME"))! - (getVal(byPeriod, p, "COST_OF_GOODS_SOLD") ?? 0)
        : null);
    const opex = getVal(byPeriod, p, "TOTAL_OPERATING_EXPENSES");
    return gp != null && opex != null ? gp - opex : null;
  });

  const netIncome = getValsFallback(byPeriod, periods, "NET_INCOME", "ORDINARY_BUSINESS_INCOME");

  const ebit = deriveValues(periods, (p) => {
    const ni = getVal(byPeriod, p, "NET_INCOME") ?? getVal(byPeriod, p, "ORDINARY_BUSINESS_INCOME");
    const ie = getVal(byPeriod, p, "INTEREST_EXPENSE") ?? 0;
    return ni != null ? ni + ie : null;
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
    { label: "Officers' Compensation", indent: 1, isBold: false, values: officerComp, showPct: true, pctBase: revenue },
    { label: "Depreciation & Amortization", indent: 1, isBold: false, values: depreciation, showPct: true, pctBase: revenue },
    { label: "Interest Expense", indent: 1, isBold: false, values: interestExpense, showPct: true, pctBase: revenue },
    { label: "Other Operating Expense", indent: 1, isBold: false, values: otherOpex, showPct: true, pctBase: revenue },
    { label: "TOTAL OPERATING EXPENSE", indent: 0, isBold: true, values: totalOpex, showPct: true, pctBase: revenue },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    { label: "NET OPERATING PROFIT", indent: 0, isBold: true, values: netOpProfit, showPct: true, pctBase: revenue },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    { label: "NET PROFIT", indent: 0, isBold: true, values: netIncome, showPct: true, pctBase: revenue },
    { label: "", indent: 0, isBold: false, values: periods.map(() => null), showPct: false },
    { label: "EBIT", indent: 1, isBold: false, values: ebit, showPct: true, pctBase: revenue },
    { label: "EBITDA", indent: 0, isBold: true, values: ebitda, showPct: true, pctBase: revenue },
  ];

  return rows;
}

function buildRatioSections(
  byPeriod: Map<string, Map<string, number | null>>,
  periods: string[],
): RatioSection[] {
  const g = (p: string, ...keys: string[]) => {
    for (const k of keys) {
      const v = getVal(byPeriod, p, k);
      if (v != null) return v;
    }
    return null;
  };

  function ratioVals(fn: (p: string) => number | string | null): (number | string | null)[] {
    return periods.map(fn);
  }

  function safeDiv(a: number | null, b: number | null): number | string | null {
    if (a == null || b == null) return null;
    if (b === 0) return "N/A";
    if (b < 0) return "N/A";
    return a / b;
  }

  const sections: RatioSection[] = [
    {
      title: "LIQUIDITY",
      rows: [
        {
          label: "Working Capital",
          values: ratioVals((p) => {
            const ca = g(p, "TOTAL_CURRENT_ASSETS", "SL_TOTAL_CURRENT_ASSETS");
            const cl = g(p, "TOTAL_CURRENT_LIABILITIES", "SL_TOTAL_CURRENT_LIABILITIES");
            return ca != null && cl != null ? ca - cl : null;
          }),
          format: "currency", decimals: 0,
        },
        {
          label: "Current Ratio",
          values: ratioVals((p) => safeDiv(
            g(p, "TOTAL_CURRENT_ASSETS", "SL_TOTAL_CURRENT_ASSETS"),
            g(p, "TOTAL_CURRENT_LIABILITIES", "SL_TOTAL_CURRENT_LIABILITIES"),
          )),
          format: "ratio", decimals: 2,
        },
        {
          label: "Quick Ratio",
          values: ratioVals((p) => {
            const ca = g(p, "TOTAL_CURRENT_ASSETS", "SL_TOTAL_CURRENT_ASSETS");
            const inv = g(p, "SL_INVENTORY") ?? 0;
            const cl = g(p, "TOTAL_CURRENT_LIABILITIES", "SL_TOTAL_CURRENT_LIABILITIES");
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
          values: ratioVals((p) => g(p, "SL_TOTAL_EQUITY")),
          format: "currency", decimals: 0,
        },
        {
          label: "Debt / Worth",
          values: ratioVals((p) => safeDiv(g(p, "SL_TOTAL_LIABILITIES"), g(p, "SL_TOTAL_EQUITY"))),
          format: "ratio", decimals: 2,
        },
        {
          label: "Total Liabilities / Total Assets",
          values: ratioVals((p) => safeDiv(g(p, "SL_TOTAL_LIABILITIES"), g(p, "SL_TOTAL_ASSETS"))),
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
          label: "DSCR",
          values: ratioVals((p) => {
            const ni = g(p, "NET_INCOME", "ORDINARY_BUSINESS_INCOME");
            const dep = g(p, "DEPRECIATION") ?? 0;
            const ie = g(p, "INTEREST_EXPENSE");
            if (ni == null || ie == null) return "N/A";
            const ds = ie; // Simplified: no CPLTD available
            if (ds === 0) return "N/A";
            return (ni + dep + ie) / ds;
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
          label: "Operating Expense %",
          values: ratioVals((p) => {
            const rev = g(p, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME");
            const opex = g(p, "TOTAL_OPERATING_EXPENSES");
            if (rev == null || opex == null || rev === 0) return null;
            return (opex / rev) * 100;
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
            const eq = g(p, "SL_TOTAL_EQUITY");
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
          label: "Net AR Days",
          values: ratioVals((p) => {
            const ar = g(p, "SL_AR_GROSS");
            const rev = g(p, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME");
            if (ar == null || rev == null || rev === 0) return null;
            return (ar / rev) * 365;
          }),
          format: "days", decimals: 1,
        },
        {
          label: "Net Sales / Total Assets",
          values: ratioVals((p) => {
            const rev = g(p, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME");
            const ta = g(p, "SL_TOTAL_ASSETS");
            return safeDiv(rev, ta);
          }),
          format: "ratio", decimals: 2,
        },
        {
          label: "Net Sales / Net Worth",
          values: ratioVals((p) => {
            const rev = g(p, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME");
            const eq = g(p, "SL_TOTAL_EQUITY");
            return safeDiv(rev, eq);
          }),
          format: "ratio", decimals: 2,
        },
      ],
    },
    {
      title: "GROWTH",
      rows: (() => {
        const growthRows: RatioRow[] = [];
        const revKeys = ["GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME"];
        const niKeys = ["NET_INCOME", "ORDINARY_BUSINESS_INCOME"];

        function yoyGrowth(keys: string[]): (number | string | null)[] {
          return periods.map((p, i) => {
            if (i === 0) return null; // no prior period
            let cur: number | null = null;
            let prev: number | null = null;
            for (const k of keys) {
              if (cur == null) cur = getVal(byPeriod, p, k);
              if (prev == null) prev = getVal(byPeriod, periods[i - 1]!, k);
            }
            if (cur == null || prev == null || prev === 0) return null;
            return ((cur - prev) / Math.abs(prev)) * 100;
          });
        }

        growthRows.push({ label: "Net Sales Growth %", values: yoyGrowth(revKeys), format: "percent", decimals: 1 });
        growthRows.push({ label: "Net Profit Growth %", values: yoyGrowth(niKeys), format: "percent", decimals: 1 });
        growthRows.push({
          label: "Total Assets Growth %",
          values: yoyGrowth(["SL_TOTAL_ASSETS"]),
          format: "percent", decimals: 1,
        });

        return growthRows;
      })(),
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

  return {
    assets: [
      { label: "Cash & Equivalents", indent: 1, isBold: false, values: getVals(byPeriod, periods, "SL_CASH"), showPct: true, pctBase: totalAssets },
      { label: "Accounts Receivable", indent: 1, isBold: false, values: getVals(byPeriod, periods, "SL_AR_GROSS"), showPct: true, pctBase: totalAssets },
      { label: "Inventory", indent: 1, isBold: false, values: getVals(byPeriod, periods, "SL_INVENTORY"), showPct: true, pctBase: totalAssets },
      { label: "TOTAL CURRENT ASSETS", indent: 0, isBold: true, values: getValsFallback(byPeriod, periods, "TOTAL_CURRENT_ASSETS", "SL_TOTAL_CURRENT_ASSETS"), showPct: true, pctBase: totalAssets },
      { label: "Net Fixed Assets", indent: 1, isBold: false, values: deriveValues(periods, (p) => {
        const ppe = getVal(byPeriod, p, "SL_PPE_GROSS");
        return ppe != null ? ppe - (getVal(byPeriod, p, "SL_ACCUMULATED_DEPRECIATION") ?? 0) : null;
      }), showPct: true, pctBase: totalAssets },
      { label: "TOTAL ASSETS", indent: 0, isBold: true, values: totalAssets, showPct: true, pctBase: totalAssets },
    ],
    liabilitiesAndNetWorth: [
      { label: "TOTAL CURRENT LIABILITIES", indent: 0, isBold: true, values: getValsFallback(byPeriod, periods, "TOTAL_CURRENT_LIABILITIES", "SL_TOTAL_CURRENT_LIABILITIES"), showPct: true, pctBase: totalAssets },
      { label: "Long-Term Debt", indent: 1, isBold: false, values: getVals(byPeriod, periods, "SL_MORTGAGES_NOTES_BONDS"), showPct: true, pctBase: totalAssets },
      { label: "TOTAL LIABILITIES", indent: 0, isBold: true, values: getVals(byPeriod, periods, "SL_TOTAL_LIABILITIES"), showPct: true, pctBase: totalAssets },
      { label: "TOTAL NET WORTH", indent: 0, isBold: true, values: getVals(byPeriod, periods, "SL_TOTAL_EQUITY"), showPct: true, pctBase: totalAssets },
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

  const statementPeriods: StatementPeriod[] = periods.map((p) => ({
    date: formatPeriodDate(p),
    months: deriveMonths(p),
    auditMethod: "Unaudited", // Default; can be enhanced later with doc metadata
    stmtType: deriveMonths(p) === 12 ? "Annual" : "Interim",
    label: derivePeriodLabel(p, currentYear),
  }));

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
    ratioSections: buildRatioSections(byPeriod, periods),
    executiveSummary: buildExecutiveSummary(byPeriod, periods),
  };
}
