import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  CashFlowRow,
  ClassicSpreadInput,
  FinancialRow,
  GlobalCashFlowSection,
  StatementPeriod,
} from "./types";
import { loadPersonalIncome } from "./personalIncomeLoader";
import {
  buildRatioSections,
  deriveTotalEquity,
  deriveTotalLiabilities,
  deriveTotalCurrentLiabilities,
  deriveTotalNonCurrentLiabilities,
} from "./classicSpreadRatios";
import { auditClassicSpread, type AuditFactRef } from "./audit/spreadAccuracyAudit";
import { buildResolvedByPeriod } from "./audit/statementTruthResolver";
import { resolveBalanceSheetSourceLines } from "./audit/balanceSheetSourceLineResolver";
import { buildClassicSpreadCertificationSummary } from "./certification/certificationSummary";
import { isBusinessStatementFact } from "./businessFactScope";
import { buildCanonicalSpreadViewModel } from "@/lib/spreads/buildCanonicalSpreadViewModel";
import {
  runClassicSpreadCertification,
  applyCertificationToInput,
} from "./certification/certifiedSpreadGate";
import { loadDealMethodology } from "@/lib/methodology/loadDealMethodology";
import { METHODOLOGY_AXES } from "@/lib/methodology/methodologyAxes";
import { DEFAULT_METHODOLOGY_SLATE } from "@/lib/methodology/methodologyDefaults";
import { buildRationale } from "@/lib/methodology/rationaleTemplates";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RawFact = {
  fact_key: string;
  fact_period_end: string | null;
  fact_value_num: number | null;
  confidence: number | null;
  created_at: string;
  id?: string | null;
  source_document_id?: string | null;
  owner_type?: string | null;
  source_canonical_type?: string | null;
  // SPEC-CLASSIC-SPREAD-BS-SOURCE-LINE-PARITY-2: provenance carries the source-line snippet used by
  // the balance-sheet source-line resolver to reclassify/suppress misclassified facts.
  provenance?: unknown;
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

  // SPEC-CLASSIC-SPREAD-PERIOD-POLICY-1:
  // Hard cap at 5 — landscape PDF can fit 5 columns with tight labels.
  // Policy: always include ALL financial-statement (IS/BS) periods first
  // (most current data), then fill remaining slots with most-recent tax years.
  const MAX_PERIODS = 5;

  // Identify tax-return periods by IRS-specific fact keys on Dec-31 dates.
  const TAX_MARKER_KEYS = new Set([
    "GROSS_RECEIPTS",
    "ORDINARY_BUSINESS_INCOME",
    "OFFICER_COMPENSATION",
    "BUSINESS_TAX_RETURN",
    "PERSONAL_TAX_RETURN",
  ]);
  const taxReturnPeriodSet = new Set<string>();
  for (const f of facts) {
    const pe = f.fact_period_end?.slice(0, 10);
    if (!pe || f.fact_value_num == null) continue;
    if (TAX_MARKER_KEYS.has(f.fact_key) && pe.endsWith("-12-31")) {
      taxReturnPeriodSet.add(pe);
    }
  }

  const allSorted = Array.from(periodSet).sort();
  const nonTaxPeriods = allSorted.filter((p) => !taxReturnPeriodSet.has(p));
  const taxPeriods = allSorted.filter((p) => taxReturnPeriodSet.has(p));

  // All non-tax (IS/BS) periods included first, then most-recent tax years
  const remaining = Math.max(0, MAX_PERIODS - nonTaxPeriods.length);
  const taxToInclude = taxPeriods.slice(-remaining);
  let periods = [...taxToInclude, ...nonTaxPeriods].sort();
  if (periods.length > MAX_PERIODS) {
    periods = periods.slice(-MAX_PERIODS);
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
  // SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #4 (policy A): Net AR uses the SAME derivation as
  // the Total Current Assets roll-up — a missing allowance is treated as zero (Net AR = Gross AR),
  // never blank. This prevents a blank Net AR row while TCA silently includes that same AR value.
  const netAr = ar.map((v, i) => (v != null ? v - (arAllowance[i] ?? 0) : null));
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
  const totalCurrentLiab = deriveTotalCurrentLiabilities(byPeriod, periods);
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

  // S-corp fallback: retained earnings = total equity.
  // Shared with the ratio engine so the visible TOTAL LIABILITIES row and the liability-derived
  // ratios derive from the identical source/rule (BUGFIX classic-spread render consistency).
  const totalEquity = deriveTotalEquity(byPeriod, periods);

  // Derive total liabilities — direct → component sum → assets−equity (shared with ratios/audit).
  const totalLiabilities = deriveTotalLiabilities(byPeriod, periods);

  // #5: non-current liabilities come from DIRECT components first, not TL − TCL (which would mask a
  // blocked/unavailable TL when shareholder loans + other liabilities are present).
  const totalNonCurrentLiab = deriveTotalNonCurrentLiabilities(byPeriod, periods);

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
  // SPEC-CLASSIC-SPREAD-SOURCE-LINE-MODEL-PARITY-1 #2 — NET sales (resolved net of returns/allowances),
  // never gross receipts and NEVER TOTAL_INCOME. The resolved overlay injects NET_SALES_REVENUE.
  const revenue = getValsFallback(byPeriod, periods, "NET_SALES_REVENUE", "GROSS_RECEIPTS", "TOTAL_REVENUE");
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

  // SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #7: the UCA AR delta must use the NET AR basis
  // (gross − allowance), not raw gross — the same Net AR shown on the balance sheet. A delta on a
  // net-of-allowance receivable that is computed from gross alone misstates the cash impact.
  const netArByPeriod = (p: string): number | null => {
    const g = getVal(byPeriod, p, "SL_AR_GROSS");
    return g != null ? g - (getVal(byPeriod, p, "SL_AR_ALLOWANCE") ?? 0) : null;
  };
  const deltaFn = (valFn: (p: string) => number | null, invert: boolean): (number | null)[] =>
    periods.map((p, i) => {
      if (i === 0) return null;
      const cur = valFn(p);
      const prev = valFn(periods[i - 1]!);
      if (cur == null || prev == null) return null;
      return invert ? cur - prev : prev - cur;
    });

  const dAR = deltaFn(netArByPeriod, false); // asset: decrease = cash in (NET AR basis)
  const dInventory = delta("SL_INVENTORY", false);
  const dOtherCA = delta("SL_OTHER_CURRENT_ASSETS", false);
  const dAP = delta("SL_ACCOUNTS_PAYABLE", true); // liability: increase = cash in
  const dWagesPayable = delta("SL_WAGES_PAYABLE", true);
  // #7: "other current liabilities" delta must use the CURRENT operating-liability field, not the
  // NON-current SL_OTHER_LIABILITIES (which belongs to long-term liabilities, not working capital).
  const dOtherCL = delta("SL_OPERATING_CURRENT_LIABILITIES", true);

  rows.push({ label: "(Inc) / Dec in Accounts Receivable", indent: 1, isBold: false, values: dAR });
  rows.push({ label: "(Inc) / Dec in Inventory", indent: 1, isBold: false, values: dInventory });
  rows.push({ label: "(Inc) / Dec in Other Current Assets", indent: 1, isBold: false, values: dOtherCA });
  rows.push({ label: "Inc / (Dec) in Accounts Payable", indent: 1, isBold: false, values: dAP });
  rows.push({ label: "Inc / (Dec) in Wages Payable", indent: 1, isBold: false, values: dWagesPayable });
  rows.push({ label: "Inc / (Dec) in Other Current Liabilities", indent: 1, isBold: false, values: dOtherCL });

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

function buildExecutiveSummary(
  byPeriod: Map<string, Map<string, number | null>>,
  periods: string[],
): ClassicSpreadInput["executiveSummary"] {
  const totalAssets = getVals(byPeriod, periods, "SL_TOTAL_ASSETS");
  // SPEC-CLASSIC-SPREAD-SOURCE-LINE-MODEL-PARITY-1 #2 — NET sales (resolved net of returns/allowances),
  // never gross receipts and NEVER TOTAL_INCOME. The resolved overlay injects NET_SALES_REVENUE.
  const revenue = getValsFallback(byPeriod, periods, "NET_SALES_REVENUE", "GROSS_RECEIPTS", "TOTAL_REVENUE");

  // SPEC-CLASSIC-SPREAD-V7-FOLLOWUP-1 #1: the Executive Financial Statement MUST use the IDENTICAL
  // liability hierarchy (direct → component sum → assets−equity) as the Detailed Balance Sheet, so
  // the two pages never disagree on TOTAL LIABILITIES (OmniCare 2024 = 2,287,062 on both).
  const totalEquity = deriveTotalEquity(byPeriod, periods);
  const totalLiabilities = deriveTotalLiabilities(byPeriod, periods);

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
// Global Cash Flow Section
// ---------------------------------------------------------------------------

async function buildGlobalCashFlowSection(
  dealId: string,
  bankId: string,
): Promise<GlobalCashFlowSection | null> {
  const sb = supabaseAdmin();

  // Read GCF-related facts (bank-scoped; exclude superseded/rejected)
  const { data: gcfFacts } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, owner_type, owner_entity_id, fact_period_end")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("is_superseded", false)
    .neq("resolution_status", "rejected")
    .in("fact_key", [
      "GCF_GLOBAL_CASH_FLOW",
      "GCF_DSCR",
      "GLOBAL_CASH_FLOW",
      "ANNUAL_DEBT_SERVICE_PROPOSED",
      "ANNUAL_DEBT_SERVICE",
      "TOTAL_PERSONAL_INCOME",
      "CASH_FLOW_AVAILABLE",
      "NOI_TTM",
      "EBITDA",
    ]);

  const facts = (gcfFacts ?? []) as Array<{
    fact_key: string;
    fact_value_num: number | null;
    owner_type: string | null;
    owner_entity_id: string | null;
    fact_period_end: string | null;
  }>;

  // Helper to find a fact value
  function findFact(key: string, ownerType?: string): number | null {
    const match = facts.find((f) => {
      if (f.fact_key !== key) return false;
      if (ownerType && f.owner_type !== ownerType) return false;
      return true;
    });
    return match?.fact_value_num ?? null;
  }

  const globalCashFlow =
    findFact("GCF_GLOBAL_CASH_FLOW") ?? findFact("GLOBAL_CASH_FLOW");
  const globalDscr = findFact("GCF_DSCR");
  const entityCashFlowAvailable =
    findFact("CASH_FLOW_AVAILABLE") ??
    findFact("NOI_TTM") ??
    findFact("EBITDA");
  const proposedDebtService =
    findFact("ANNUAL_DEBT_SERVICE_PROPOSED") ??
    findFact("ANNUAL_DEBT_SERVICE");

  // Fallback: if no TOTAL_PERSONAL_INCOME facts exist (backfill hasn't run),
  // compute from raw PERSONAL_INCOME-type facts (AGI + depreciation add-backs).
  // Require at least one TOTAL_PERSONAL_INCOME fact with owner_type="PERSONAL"
  // AND a meaningful value (> 1000) to be considered materialized.
  // A value of 3 or similar is a Phase 17 bootstrap placeholder — treat as absent.
  const hasMaterializedPI = facts.some(
    (f) =>
      f.fact_key === "TOTAL_PERSONAL_INCOME" &&
      f.owner_type === "PERSONAL" &&
      (f.fact_value_num ?? 0) > 1000,
  );
  if (!hasMaterializedPI) {
    const { data: rawPiFacts } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, owner_type, owner_entity_id, fact_period_end")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("fact_type", "PERSONAL_INCOME")
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .not("fact_value_num", "is", null);

    if (rawPiFacts && rawPiFacts.length > 0) {
      // Group by owner_entity_id, pick latest period per owner, sum income components
      const byOwner = new Map<string, Map<string, number>>();
      for (const f of rawPiFacts as Array<{ fact_key: string; fact_value_num: number; owner_entity_id: string | null; fact_period_end: string | null }>) {
        const oid = f.owner_entity_id ?? "default";
        if (!byOwner.has(oid)) byOwner.set(oid, new Map());
        const m = byOwner.get(oid)!;
        // Keep latest value per key (facts are not ordered, so overwrite is OK)
        m.set(f.fact_key, f.fact_value_num);
      }

      for (const [oid, m] of byOwner) {
        // Personal income for GCF = AGI + depreciation add-backs
        const agi = m.get("ADJUSTED_GROSS_INCOME") ?? null;
        const schEDep = m.get("SCH_E_DEPRECIATION") ?? 0;
        const qbi = m.get("QBI_DEDUCTION") ?? 0;
        if (agi !== null) {
          const totalPI = agi + schEDep + Math.abs(qbi);
          facts.push({
            fact_key: "TOTAL_PERSONAL_INCOME",
            fact_value_num: totalPI,
            owner_type: "PERSONAL",
            owner_entity_id: oid === "default" ? null : oid,
            fact_period_end: rawPiFacts.find((f: any) => (f.owner_entity_id ?? "default") === oid)?.fact_period_end ?? null,
          });
        }
      }
    }
  }

  // If we have no GCF data at all, skip the page
  const hasAnyData =
    globalCashFlow != null ||
    entityCashFlowAvailable != null ||
    facts.some((f) => f.fact_key === "TOTAL_PERSONAL_INCOME");
  if (!hasAnyData) return null;

  // Count operating entities
  const { data: entityRows } = await (sb as any)
    .from("deal_entities")
    .select("id, name, entity_kind")
    .eq("deal_id", dealId)
    .in("entity_kind", ["OPCO", "PROPCO", "HOLDCO"]);
  const entityCount = (entityRows ?? []).length;

  // Build sponsor list from personal income facts
  const personalFacts = facts.filter(
    (f) => f.fact_key === "TOTAL_PERSONAL_INCOME" && f.owner_type === "PERSONAL",
  );

  // Load sponsor display names
  const sponsorEntityIds = personalFacts
    .map((f) => f.owner_entity_id)
    .filter(Boolean) as string[];

  let sponsorNames = new Map<string, string>();
  if (sponsorEntityIds.length > 0) {
    const { data: sponsorRows } = await (sb as any)
      .from("deal_entities")
      .select("id, name")
      .in("id", sponsorEntityIds);
    for (const r of sponsorRows ?? []) {
      sponsorNames.set(r.id as string, (r.name ?? "Guarantor") as string);
    }
  }

  const sponsors = personalFacts.map((f, i) => ({
    entityId: f.owner_entity_id ?? `unknown-${i}`,
    displayName:
      sponsorNames.get(f.owner_entity_id ?? "") ?? `Guarantor ${i + 1}`,
    personalCashAvailable: f.fact_value_num,
  }));

  // Derive tax year from most recent fact period
  let taxYear: number | null = null;
  for (const f of facts) {
    if (f.fact_period_end) {
      const y = parseInt(f.fact_period_end.slice(0, 4), 10);
      if (!isNaN(y) && y > 2000 && (taxYear === null || y > taxYear)) {
        taxYear = y;
      }
    }
  }

  // Coverage status
  let coverageStatus: GlobalCashFlowSection["coverageStatus"] = "UNKNOWN";
  if (globalDscr != null) {
    if (globalDscr >= 1.25) coverageStatus = "ADEQUATE";
    else if (globalDscr >= 1.0) coverageStatus = "TIGHT";
    else coverageStatus = "DEFICIT";
  }

  // SPEC-B4 — Load methodology entries for the PDF methodology block
  let methodologyEntries: GlobalCashFlowSection["methodology"] | undefined;
  if (bankId) {
    try {
      const { slate } = await loadDealMethodology(dealId, bankId);
      methodologyEntries = (Object.keys(slate) as Array<keyof typeof slate>).map((axisId) => {
        const axisConfig = (METHODOLOGY_AXES as any)[axisId];
        const variantConfig = axisConfig?.variants?.find((v: any) => v.id === slate[axisId]);
        return {
          axisId: axisId as "ncads_source" | "ebitda_addback_stack" | "officer_comp" | "affiliate_ownership" | "living_expense",
          axisLabel: axisConfig?.label ?? axisId,
          chosenVariantId: slate[axisId],
          chosenVariantLabel: variantConfig?.label ?? slate[axisId],
          rationale: buildRationale(axisId as any, slate[axisId]),
          isDefault: slate[axisId] === (DEFAULT_METHODOLOGY_SLATE as any)[axisId],
        };
      });
    } catch {
      // Non-fatal — methodology entries are supplemental to the PDF
    }
  }

  return {
    taxYear,
    entityCashFlowAvailable,
    entityCount,
    sponsors,
    globalCashFlow,
    proposedAnnualDebtService: proposedDebtService,
    globalDscr,
    coverageStatus,
    methodology: methodologyEntries,
  };
}

// ---------------------------------------------------------------------------
// Main Loader
// ---------------------------------------------------------------------------

export async function loadClassicSpreadData(dealId: string, bankId: string): Promise<ClassicSpreadInput> {
  const sb = supabaseAdmin();

  // SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #1: bank-scope EVERY fact read. The caller passes
  // the access-checked bankId; facts (and every downstream section) filter on it so a sibling-bank
  // tenant's facts can never enter this spread.
  const [factsRes, dealRes] = await Promise.all([
    sb
      .from("deal_financial_facts")
      .select("id, fact_key, fact_period_end, fact_value_num, confidence, created_at, source_document_id, owner_type, source_canonical_type, provenance")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .not("fact_value_num", "is", null),
    sb
      .from("deals")
      .select("id, name, borrower_name, bank_id")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .maybeSingle(),
  ]);

  if (factsRes.error) throw new Error(`facts_query_failed: ${factsRes.error.message}`);
  const deal = dealRes.data as { id: string; name: string | null; borrower_name: string | null; bank_id: string | null } | null;

  let bankName = "Bank";
  {
    const { data: bank } = await sb
      .from("banks")
      .select("name")
      .eq("id", bankId)
      .maybeSingle();
    bankName = (bank as { name: string } | null)?.name ?? "Bank";
  }

  // Exclude sentinel EXTRACTION_HEARTBEAT facts:
  // - fact_key starting with "document:" are OCR anchor facts (not financial data)
  // - fact_period_end year < 2000 is a sentinel date (1900-01-01 used for heartbeats)
  const businessFacts = ((factsRes.data ?? []) as RawFact[]).filter((f) => {
    if (f.fact_key?.startsWith("document:")) return false;
    if (f.fact_period_end) {
      const year = parseInt(f.fact_period_end.slice(0, 4), 10);
      if (!isNaN(year) && year < 2000) return false;
    }
    // #2: business statements consume business facts only; personal-return facts are excluded here
    // and surface only on the Personal Income / GCF sponsor sections.
    if (!isBusinessStatementFact(f)) return false;
    return true;
  });

  // SPEC-CLASSIC-SPREAD-BS-SOURCE-LINE-PARITY-2: correct three balance-sheet source-line
  // MISCLASSIFICATIONS using each fact's provenance/source line (never a blind numeric heuristic) —
  // Schedule L "Other current liabilities" → current bucket, OCR line-number micro-stub suppression,
  // and an interim "Accounts receivable" line mislabeled as Total Current Assets. Pure + non-fatal;
  // it only re-keys/suppresses an in-memory copy and never mutates the underlying facts.
  const { facts, audit: bsSourceLineAudit } = resolveBalanceSheetSourceLines(businessFacts);
  if (bsSourceLineAudit.length > 0) {
    console.info("[classic-spread] balance-sheet source-line corrections", {
      dealId,
      corrections: bsSourceLineAudit.map((a) => `${a.periodEnd} ${a.originalKey}→${a.resolvedKey ?? "(suppressed)"} [${a.code}]`),
    });
  }
  const currentYear = new Date().getFullYear();

  // SPEC-SPREAD-SOURCE-OF-TRUTH-UNIFICATION-1: the canonical reconciled view model is the
  // SINGLE source of truth for which period columns render and their source attribution
  // (audit method, statement type, months covered) — derived from the ACTUAL facts'
  // source_canonical_type per column, not inferred from dates/fact-key presence.
  const canonByPeriod = new Map<string, { auditMethod: string; statementType: string; monthsCovered: number | null }>();
  {
    try {
      const vm = await buildCanonicalSpreadViewModel(dealId, bankId);
      for (const c of vm.columns) {
        canonByPeriod.set(c.periodEnd, { auditMethod: c.auditMethod, statementType: c.statementType, monthsCovered: c.monthsCovered });
      }
    } catch {
      // Non-fatal — fall back to the legacy period list + per-period derivation below.
    }
  }

  // SPEC-CLASSIC-SPREAD-FINANCIAL-PERIOD-SPINE-1: restrict the period universe (and thus the
  // 5-column cap math in buildPeriodMaps) to the VM's eligible statement periods. The VM
  // already excludes AR-aging / PFS / personal-tax / collateral periods, so non-statement
  // periods can no longer consume a cap slot and push a real tax year (e.g. 2022) out.
  const eligibleFacts =
    canonByPeriod.size > 0
      ? facts.filter((f) => {
          const pe = f.fact_period_end?.slice(0, 10);
          return pe ? canonByPeriod.has(pe) : true;
        })
      : facts;
  const { periods: rawPeriods, byPeriod } = buildPeriodMaps(eligibleFacts);

  // Drive the rendered period list from the VM when available: drop any period the VM did
  // not emit (empty columns the VM suppressed, or columns whose facts were quarantined).
  // Surviving periods therefore always carry VM attribution — the legacy "Company Prepared"
  // fallback only runs when the VM is entirely unavailable.
  const periods = canonByPeriod.size > 0 ? rawPeriods.filter((p) => canonByPeriod.has(p)) : rawPeriods;

  const statementPeriods: StatementPeriod[] = periods.map((p) => {
    const canon = canonByPeriod.get(p);
    const auditMethod = canon?.auditMethod ?? deriveAuditMethod(byPeriod, p);
    const months = canon?.monthsCovered ?? deriveMonths(p);
    const stmtType =
      canon?.statementType && canon.statementType !== "Unknown"
        ? (canon.statementType === "Interim" ? "Interim" : "Annual")
        : auditMethod === "Tax Return"
          ? "Annual"
          : months === 12
            ? "Annual"
            : "Interim";
    return {
      date: formatPeriodDate(p),
      months,
      auditMethod,
      stmtType,
      label: derivePeriodLabel(p, currentYear),
    };
  });

  // Check if we have BS or IS data
  const hasBsData = periods.some((p) => getVal(byPeriod, p, "SL_TOTAL_ASSETS") != null);
  const hasIsData = periods.some((p) =>
    getVal(byPeriod, p, "GROSS_RECEIPTS") != null ||
    getVal(byPeriod, p, "NET_SALES_REVENUE") != null ||
    getVal(byPeriod, p, "TOTAL_REVENUE") != null ||
    getVal(byPeriod, p, "NET_INCOME") != null,
  );

  const now = new Date();
  const preparedDate = now.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + ", " + now.toLocaleDateString("en-US");

  // SPEC-CLASSIC-SPREAD-TRUTH-RESOLVER-RENDER-WIRING-1: the rendered Detailed BS / Executive /
  // Ratios / Cash Flow rows derive from the RESOLVED overlay — wrong direct totals (e.g. 2024
  // direct equity, 2025 AR-only TCA) are corrected to the resolver's arbitrated value. The audit
  // keeps the ORIGINAL `byPeriod` so it still detects and reports the rejected source (BLOCKER).
  const resolvedByPeriod = buildResolvedByPeriod(byPeriod, periods);

  const cashFlowRows = hasBsData && hasIsData ? buildCashFlowRows(resolvedByPeriod, periods) : [];
  // Cash flow periods exclude the first period (need prior for deltas)
  const cfPeriods = periods.length >= 2 ? statementPeriods : [];

  // Single source of truth for liability-derived ratios: the EXACT array that populates the
  // visible TOTAL LIABILITIES row, from the resolved overlay so ratios match the rendered rows.
  const totalLiabilitiesForRatios = deriveTotalLiabilities(resolvedByPeriod, periods);

  // Global cash flow section (Phase 18 facts → Phase 19 PDF page)
  const globalCashFlow = await buildGlobalCashFlowSection(dealId, bankId);

  // Personal income section — load PERSONAL_INCOME facts if any exist
  const personalIncome = await loadPersonalIncome(dealId, bankId);

  const input: ClassicSpreadInput = {
    dealId,
    companyName: deal?.borrower_name ?? deal?.name ?? "Unknown Company",
    preparedDate,
    naicsCode: null,
    naicsDescription: null,
    bankName,
    periods: statementPeriods,
    balanceSheet: hasBsData ? buildBalanceSheetRows(resolvedByPeriod, periods) : [],
    incomeStatement: hasIsData ? buildIncomeStatementRows(resolvedByPeriod, periods) : [],
    cashFlow: cashFlowRows,
    cashFlowPeriods: cfPeriods,
    ratioSections: buildRatioSections(resolvedByPeriod, periods, cashFlowRows, totalLiabilitiesForRatios),
    globalCashFlow,
    personalIncome,
    executiveSummary: buildExecutiveSummary(resolvedByPeriod, periods),
  };

  // SPEC-CLASSIC-SPREAD-CERTIFICATION-INTEGRATION-GATE-1 (Phase 6): pre-render certification gate.
  // Suppress blocked values and replace weak personal-income values with certified ones BEFORE the
  // PDF is rendered, and persist the audit.
  // SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #9: FAIL CLOSED — if certification throws or
  // returns null, the spread is NOT certified and the PDF must say so. Never silently render an
  // apparently-certified spread.
  input.certified = false;
  {
    const gate = await runClassicSpreadCertification(dealId, bankId, {
      periods,
      gcfTaxYear: globalCashFlow?.taxYear ?? null,
    });
    if (gate) {
      input.certified = true;
      applyCertificationToInput(input, gate.decisions);
      input.certificationAudit = gate.audit;

      // SPEC-CLASSIC-SPREAD-LINE-ACCURACY-COMPLETION-AUDIT-1: run the line-accuracy / completion
      // audit on the FINAL (post-suppression) rows vs the source facts, and attach it as a
      // certification domain so it persists into rendered_json and reaches the PDF + narrative.
      try {
        const auditPeriods = periods.map((p, i) => ({ iso: p, label: statementPeriods[i]?.label ?? p }));
        const renderedIso = new Set(periods);
        const factRefs: AuditFactRef[] = [];
        for (const f of facts) {
          const pe = f.fact_period_end?.slice(0, 10);
          if (!pe || !renderedIso.has(pe)) continue;
          factRefs.push({ period: pe, factKey: f.fact_key, factId: f.id ?? null, documentId: f.source_document_id ?? null });
        }
        gate.audit.spreadAccuracy = auditClassicSpread({
          periods: auditPeriods,
          byPeriod,
          balanceSheet: input.balanceSheet,
          incomeStatement: input.incomeStatement,
          cashFlow: input.cashFlow,
          factRefs,
          // #6: arbitrate candidate facts via the statement truth resolver and surface its findings.
          resolve: true,
        });

        // SPEC-CLASSIC-SPREAD-BANKER-REVIEW-ACTIONS-1 #5: consume reviewed banker decisions so the
        // rendered PDF + persisted audit reflect confirmations/waivers/verifications. Non-fatal and
        // never clears a blocker without a reviewer (enforced inside applyReviewDecisions).
        let openReviewActionCount: number | undefined;
        try {
          const { loadReviewDecisions } = await import("./review/reviewActionsRepo");
          const { applyReviewDecisions } = await import("./review/applyReviewDecisions");
          const decisions = await loadReviewDecisions(dealId, bankId);
          // Open = still-actionable review rows (pruned/closed rows are excluded by the repo).
          openReviewActionCount = decisions.filter((d) => d.status === "open").length;
          if (decisions.length > 0 && gate.audit.spreadAccuracy) {
            gate.audit.spreadAccuracy = applyReviewDecisions(gate.audit.spreadAccuracy, decisions);
          }
        } catch {
          // Non-fatal — decisions are an overlay on top of the audit.
        }

        // SPEC-CLASSIC-SPREAD-CERTIFICATION-GATE-PDF-VERSION-1: honest certified/preliminary/blocked
        // roll-up over the post-decision audit, surfaced on the PDF and safe for memo consumers.
        input.certificationSummary = buildClassicSpreadCertificationSummary({
          certified: true,
          audit: gate.audit,
          openReviewActionCount,
          globalCashFlow: input.globalCashFlow ?? null,
        });
      } catch {
        // Non-fatal — the audit is supplemental; a failure must not block the PDF.
      }
    }
  }

  // Fail closed: if the gate never produced a certification summary, the spread is NOT certified.
  if (!input.certificationSummary) {
    input.certificationSummary = buildClassicSpreadCertificationSummary({
      certified: input.certified === true,
      audit: input.certificationAudit ?? null,
      globalCashFlow: input.globalCashFlow ?? null,
    });
  }

  return input;
}
