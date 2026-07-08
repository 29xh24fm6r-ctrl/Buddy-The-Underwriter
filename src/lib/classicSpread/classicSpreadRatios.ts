/**
 * Pure ratio + balance-sheet-derivation core for the classic spread.
 *
 * Extracted from classicSpreadLoader.ts (which is `server-only`) so the leverage/growth ratio
 * logic can be unit-tested without DB IO. NOTHING here touches Supabase, the canonical VM, or
 * reconcileFinancialFacts.
 *
 * BUGFIX (classic-spread render consistency, Patch A): the visible TOTAL LIABILITIES row and the
 * liability-derived ratios (Debt/Worth, Debt/Tangible Net Worth, Total Liabilities/Total Assets,
 * Total Liabilities Growth %) MUST agree. The loader feeds `deriveTotalLiabilities()` — the exact
 * source/rule used to populate the visible TOTAL LIABILITIES row — into buildRatioSections(), and
 * a dependent ratio cell renders only when that period's Total Liabilities is available.
 */

import type { CashFlowRow, RatioSection } from "./types";
import { classicTraditionalEbitda } from "./classicEbitda";

export type PeriodMaps = Map<string, Map<string, number | null>>;

function getVal(byPeriod: PeriodMaps, period: string, key: string): number | null {
  return byPeriod.get(period)?.get(key) ?? null;
}

function deriveValues(
  periods: string[],
  fn: (period: string) => number | null,
): (number | null)[] {
  return periods.map(fn);
}

/** Total equity with the S-corp fallback (retained earnings = total equity). */
export function deriveTotalEquity(byPeriod: PeriodMaps, periods: string[]): (number | null)[] {
  return deriveValues(periods, (p) => {
    const direct = getVal(byPeriod, p, "SL_TOTAL_EQUITY");
    if (direct != null) return direct;
    return getVal(byPeriod, p, "SL_RETAINED_EARNINGS");
  });
}

function sumPresent(components: (number | null)[]): number | null {
  const present = components.filter((v): v is number => v != null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}

/** Total current liabilities — direct fact, else the sum of present current-liability components. */
export function deriveTotalCurrentLiabilities(byPeriod: PeriodMaps, periods: string[]): (number | null)[] {
  return deriveValues(periods, (p) => {
    const direct = getVal(byPeriod, p, "TOTAL_CURRENT_LIABILITIES") ?? getVal(byPeriod, p, "SL_TOTAL_CURRENT_LIABILITIES");
    if (direct != null) return direct;
    return sumPresent([
      getVal(byPeriod, p, "SL_ACCOUNTS_PAYABLE"),
      getVal(byPeriod, p, "SL_WAGES_PAYABLE"),
      getVal(byPeriod, p, "SL_SHORT_TERM_DEBT"),
      getVal(byPeriod, p, "SL_OPERATING_CURRENT_LIABILITIES"),
    ]);
  });
}

/**
 * Total non-current liabilities — SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #5: derive from the
 * DIRECT non-current components (mortgages + loans from shareholders + other liabilities) when any
 * exist. Never `TL − TCL` when direct non-current components are present (that masks a blocked TL).
 * Only when no direct components exist do we fall back to `TL − TCL`.
 */
export function deriveTotalNonCurrentLiabilities(byPeriod: PeriodMaps, periods: string[]): (number | null)[] {
  const tcl = deriveTotalCurrentLiabilities(byPeriod, periods);
  return deriveValues(periods, (p) => {
    const components = sumPresent([
      getVal(byPeriod, p, "SL_MORTGAGES_NOTES_BONDS"),
      getVal(byPeriod, p, "SL_LOANS_FROM_SHAREHOLDERS"),
      getVal(byPeriod, p, "SL_OTHER_LIABILITIES"),
    ]);
    if (components != null) return components;
    // SPEC-CLASSIC-SPREAD-BLOCKER-BATCH-RESOLUTION-1 #1: no direct non-current components.
    const directTl = getVal(byPeriod, p, "SL_TOTAL_LIABILITIES");
    const i = periods.indexOf(p);
    // Fall back to TL − TCL when a direct TL exists, never negative; otherwise, when TCL is known
    // with no non-current evidence, Total Non-Current Liabilities is 0 (do not invent debt).
    if (directTl != null && tcl[i] != null) return Math.max(0, directTl - tcl[i]!);
    if (tcl[i] != null) return 0;
    return null;
  });
}

/**
 * Total liabilities — SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #5 derivation hierarchy:
 *   1. direct certified total (SL_TOTAL_LIABILITIES)
 *   2. component sum (current + non-current components)
 *   3. balancing fallback (assets − equity)
 * A direct-vs-component material conflict is surfaced by the line-accuracy audit, not silently
 * averaged. Never falls back to zero.
 */
export function deriveTotalLiabilities(byPeriod: PeriodMaps, periods: string[]): (number | null)[] {
  const totalEquity = deriveTotalEquity(byPeriod, periods);
  const tcl = deriveTotalCurrentLiabilities(byPeriod, periods);
  const tncl = deriveTotalNonCurrentLiabilities(byPeriod, periods);
  return deriveValues(periods, (p) => {
    const i = periods.indexOf(p);
    const direct = getVal(byPeriod, p, "SL_TOTAL_LIABILITIES");
    let v: number | null;
    if (direct != null) v = direct;
    else if (tcl[i] != null || tncl[i] != null) v = (tcl[i] ?? 0) + (tncl[i] ?? 0);
    else {
      const ta = getVal(byPeriod, p, "SL_TOTAL_ASSETS");
      const eq = totalEquity[i];
      v = ta != null && eq != null ? ta - eq : null;
    }
    // Parity guard (#1): Total Liabilities is never less than Total Current Liabilities.
    if (v != null && tcl[i] != null && v < tcl[i]!) v = tcl[i]!;
    return v;
  });
}

/**
 * Whether a period's Total Liabilities can feed a liability-derived ratio.
 *
 * Mirrors the renderer's fmtNumber blank rule (null OR 0 renders as a blank em-dash): if the
 * visible TOTAL LIABILITIES cell would be blank, no dependent ratio cell may show a value.
 * Type guard so callers narrow to `number`.
 */
export function isLiabilityRatioAvailable(tl: number | null): tl is number {
  return tl != null && tl !== 0;
}

export function buildRatioSections(
  byPeriod: PeriodMaps,
  periods: string[],
  cashFlowRows: CashFlowRow[],
  totalLiabilitiesForRatios: (number | null)[],
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
          // Patch A: derives from the visible TOTAL LIABILITIES value — blank when unavailable.
          values: ratioVals((p, i) => {
            const tl = totalLiabilitiesForRatios[i] ?? null;
            if (!isLiabilityRatioAvailable(tl)) return null;
            return safeDiv(tl, getEquity(p));
          }),
          format: "ratio", decimals: 2,
        },
        {
          label: "Debt / Tangible Net Worth",
          values: ratioVals((p, i) => {
            const tl = totalLiabilitiesForRatios[i] ?? null;
            if (!isLiabilityRatioAvailable(tl)) return null;
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
          values: ratioVals((p, i) => {
            const tl = totalLiabilitiesForRatios[i] ?? null;
            if (!isLiabilityRatioAvailable(tl)) return null;
            return safeDiv(tl, g(p, "SL_TOTAL_ASSETS"));
          }),
          format: "ratio", decimals: 2,
        },
      ],
    },
    {
      title: "COVERAGE",
      rows: [
        {
          label: "EBITDA",
          // SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1: canonical EBITDA base (C-corp income-tax
          // add-back applied consistently) instead of the after-tax NET_INCOME + add-backs formula.
          values: ratioVals((p) => classicTraditionalEbitda((key) => g(p, key))),
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
          // SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1: this row divides by INTEREST EXPENSE ONLY
          // (no principal), so it is interest-only coverage — NOT DSCR. Canonical DSCR is
          // CF_NCADS / ANNUAL_DEBT_SERVICE (a deal-level metric on the snapshot); a per-period tax
          // return carries interest but not principal, so it cannot yield a true DSCR. Renamed +
          // numerator routed through the canonical EBITDA base.
          label: "Interest-Only Coverage (EBITDA)",
          values: ratioVals((p) => {
            const ebitda = classicTraditionalEbitda((key) => g(p, key));
            const ie = g(p, "INTEREST_EXPENSE");
            if (ebitda == null || ie == null || ie === 0) return "N/A";
            return ebitda / ie;
          }),
          format: "ratio", decimals: 2,
        },
        {
          // SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1: UCA operating cash flow ÷ INTEREST ONLY is
          // interest-only coverage, not DSCR (no principal in the denominator). Renamed.
          label: "Interest-Only Coverage (UCA Cash Flow)",
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
            const rev = g(p, "NET_SALES_REVENUE", "GROSS_RECEIPTS", "TOTAL_REVENUE");
            const gp = g(p, "GROSS_PROFIT") ?? (rev != null ? rev - (g(p, "COST_OF_GOODS_SOLD") ?? 0) : null);
            if (rev == null || gp == null || rev === 0) return null;
            return (gp / rev) * 100;
          }),
          format: "percent", decimals: 1,
        },
        {
          label: "Operating Profit Margin %",
          values: ratioVals((p) => {
            const rev = g(p, "NET_SALES_REVENUE", "GROSS_RECEIPTS", "TOTAL_REVENUE");
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
            const rev = g(p, "NET_SALES_REVENUE", "GROSS_RECEIPTS", "TOTAL_REVENUE");
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
            const rev = g(p, "NET_SALES_REVENUE", "GROSS_RECEIPTS", "TOTAL_REVENUE");
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
          values: ratioVals((p) => safeDiv(g(p, "NET_SALES_REVENUE", "GROSS_RECEIPTS", "TOTAL_REVENUE"), g(p, "SL_TOTAL_ASSETS"))),
          format: "ratio", decimals: 2,
        },
        {
          label: "Net Sales / Net Worth",
          values: ratioVals((p) => safeDiv(g(p, "NET_SALES_REVENUE", "GROSS_RECEIPTS", "TOTAL_REVENUE"), getEquity(p))),
          format: "ratio", decimals: 2,
        },
      ],
    },
    {
      title: "GROWTH",
      rows: [
        {
          label: "Net Sales Growth %",
          values: yoyGrowth((p) => g(p, "NET_SALES_REVENUE", "GROSS_RECEIPTS", "TOTAL_REVENUE")),
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
          // Patch A: YoY change is computable only when BOTH endpoints' Total Liabilities are
          // available (matching the visible TOTAL LIABILITIES row); otherwise the cell is blank.
          values: periods.map((_p, i) => {
            if (i === 0) return null;
            const cur = totalLiabilitiesForRatios[i] ?? null;
            const prev = totalLiabilitiesForRatios[i - 1] ?? null;
            if (!isLiabilityRatioAvailable(cur) || !isLiabilityRatioAvailable(prev)) return null;
            return ((cur - prev) / Math.abs(prev)) * 100;
          }),
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
