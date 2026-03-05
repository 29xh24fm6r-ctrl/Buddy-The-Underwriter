/**
 * Model Engine V2 — Financial Model Builder
 *
 * Converts canonical deal_financial_facts → normalized FinancialModel.
 *
 * Rules:
 * - Sentinel-date (1900-01-01) INCOME_STATEMENT/BALANCE_SHEET facts are promoted
 *   to the latest real period (T12/BS from spreads use sentinel as "current/undated")
 * - Other sentinel-date facts are skipped
 * - No cloning values across periods
 * - Strict grouping by period_end
 * - Derived values computed from available inputs only
 */

import type { FinancialModel, FinancialPeriod, PeriodType } from "./types";

// ---------------------------------------------------------------------------
// Sentinel dates that indicate "no real date" — skip these
// ---------------------------------------------------------------------------

const SENTINEL_DATES = new Set([
  "1900-01-01",
  "1970-01-01",
  "0001-01-01",
]);

const PERIOD_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validate a period_end date. Returns true if the date should be skipped.
 *
 * Guards:
 * - null/undefined → skip
 * - Known sentinel dates → skip
 * - Unparseable dates → skip
 * - Year < 2000 → skip (no legitimate commercial underwriting data before 2000)
 */
function isInvalidPeriodDate(d: string | null | undefined): boolean {
  if (!d) return true;
  if (SENTINEL_DATES.has(d)) return true;
  const m = d.match(PERIOD_DATE_RE);
  if (!m) return true; // unparseable
  const year = Number(m[1]);
  if (year < 2000) return true;
  return false;
}

/** @deprecated Use isInvalidPeriodDate */
function isSentinelDate(d: string | null | undefined): boolean {
  return isInvalidPeriodDate(d);
}

// ---------------------------------------------------------------------------
// Fact type → period slot mapping
// ---------------------------------------------------------------------------

/**
 * Priority-based income slot mapping.
 *
 * Multiple fact keys can target the same income field (e.g. GROSS_RECEIPTS
 * and TOTAL_INCOME both → "revenue"). When duplicates exist (same key from
 * different source documents, or different keys targeting the same field),
 * the HIGHEST PRIORITY wins regardless of array order.
 *
 * Within the same priority tier, the first fact encountered wins (stable).
 */
type IncomeSlot = { field: keyof FinancialPeriod["income"]; priority: number };
const INCOME_PRIORITY: Record<string, IncomeSlot> = {
  // ── revenue ───────────────────────────────────────────────────────────
  TOTAL_REVENUE:             { field: "revenue", priority: 10 },
  GROSS_RECEIPTS:            { field: "revenue", priority: 10 }, // 1065 line 1c / 1120 line 1c
  TOTAL_INCOME:              { field: "revenue", priority: 5 },  // 1065 line 8 — fallback
  // ── cogs ──────────────────────────────────────────────────────────────
  COST_OF_GOODS_SOLD:        { field: "cogs", priority: 10 },
  // ── operatingExpenses ─────────────────────────────────────────────────
  TOTAL_OPERATING_EXPENSES:  { field: "operatingExpenses", priority: 10 },
  TOTAL_DEDUCTIONS:          { field: "operatingExpenses", priority: 5 },  // 1065 line 22 / 1120 line 27
  // ── depreciation ──────────────────────────────────────────────────────
  DEPRECIATION:              { field: "depreciation", priority: 10 },
  // ── interest ──────────────────────────────────────────────────────────
  DEBT_SERVICE:              { field: "interest", priority: 10 },
  INTEREST_EXPENSE:          { field: "interest", priority: 8 },  // 1065 line 15 / 1120 line 18
  // ── netIncome ─────────────────────────────────────────────────────────
  ORDINARY_BUSINESS_INCOME:  { field: "netIncome", priority: 10 }, // 1065 line 23 / 1120 line 28
  NET_INCOME:                { field: "netIncome", priority: 8 },
  TAXABLE_INCOME:            { field: "netIncome", priority: 5 },  // 1040 line 15
  ADJUSTED_GROSS_INCOME:     { field: "netIncome", priority: 3 },  // 1040 line 11 — lowest
};

const BALANCE_MAP: Record<string, keyof FinancialPeriod["balance"]> = {
  CASH_AND_EQUIVALENTS: "cash",
  ACCOUNTS_RECEIVABLE: "accountsReceivable",
  INVENTORY: "inventory",
  TOTAL_ASSETS: "totalAssets",
  SHORT_TERM_DEBT: "shortTermDebt",
  LONG_TERM_DEBT: "longTermDebt",
  TOTAL_LIABILITIES: "totalLiabilities",
  TOTAL_EQUITY: "equity",
};

const CASHFLOW_MAP: Record<string, keyof FinancialPeriod["cashflow"]> = {
  CAPITAL_EXPENDITURES: "capex",
};

// Fact types we care about
const RELEVANT_FACT_TYPES = new Set([
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
  "TAX_RETURN",
  "PERSONAL_INCOME",
]);

// ---------------------------------------------------------------------------
// Fact input type (matches deal_financial_facts row shape)
// ---------------------------------------------------------------------------

export interface FactInput {
  fact_type: string;
  fact_key: string;
  fact_value_num: number | null;
  fact_period_end: string | null;
  confidence?: number | null;
}

// ---------------------------------------------------------------------------
// Period type inference
// ---------------------------------------------------------------------------

function inferPeriodType(periodEnd: string): PeriodType {
  // If month is December → likely FYE
  const m = periodEnd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m && m[2] === "12") return "FYE";
  // Default to TTM (most common in underwriting)
  return "TTM";
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildFinancialModel(
  dealId: string,
  facts: FactInput[],
): FinancialModel {
  // Group facts by period_end in two passes:
  // 1. Real-dated facts → grouped normally
  // 2. Sentinel-date INCOME_STATEMENT/BALANCE_SHEET → promoted to latest real period
  //    (T12 and balance sheet data from spreads use 1900-01-01 as "current/undated")
  const byPeriod = new Map<string, FactInput[]>();

  // First pass: collect real-dated facts and track max real date
  const realDates: string[] = [];
  for (const f of facts) {
    if (!RELEVANT_FACT_TYPES.has(f.fact_type)) continue;
    if (f.fact_value_num === null) continue;
    if (isInvalidPeriodDate(f.fact_period_end)) continue;

    const pe = f.fact_period_end!;
    if (!byPeriod.has(pe)) byPeriod.set(pe, []);
    byPeriod.get(pe)!.push(f);
    realDates.push(pe);
  }

  // Second pass: promote sentinel-date INCOME_STATEMENT and BALANCE_SHEET facts
  // to the latest real period. These are T12/BS data from AI extraction that lack
  // a specific fiscal year. They process AFTER real facts so T12 values (which are
  // more complete) win over tax return form-reference values on key conflicts.
  const sentinelProxy = realDates.length > 0
    ? realDates.sort().pop()!
    : null;

  if (sentinelProxy) {
    for (const f of facts) {
      if (f.fact_value_num === null) continue;
      if (!isInvalidPeriodDate(f.fact_period_end)) continue;
      if (f.fact_type !== "INCOME_STATEMENT" && f.fact_type !== "BALANCE_SHEET") continue;

      if (!byPeriod.has(sentinelProxy)) byPeriod.set(sentinelProxy, []);
      byPeriod.get(sentinelProxy)!.push(f);
    }
  }

  // Build periods
  const periods: FinancialPeriod[] = [];

  for (const [periodEnd, periodFacts] of byPeriod) {
    const period: FinancialPeriod = {
      periodId: `${dealId}:${periodEnd}`,
      periodEnd,
      type: inferPeriodType(periodEnd),
      income: {},
      balance: {},
      cashflow: {},
      qualityFlags: [],
    };

    // Map facts to period slots (priority-based: highest priority wins per field)
    const fieldPriority: Record<string, number> = {};

    // Sort by confidence DESC so higher-confidence facts from different
    // source documents win when two facts share the same key + priority.
    const sorted = [...periodFacts].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
    );

    for (const f of sorted) {
      const slot = INCOME_PRIORITY[f.fact_key];
      if (slot) {
        const cur = fieldPriority[slot.field] ?? -1;
        if (slot.priority > cur) {
          period.income[slot.field] = f.fact_value_num!;
          fieldPriority[slot.field] = slot.priority;
        }
        continue;
      }

      const balanceField = BALANCE_MAP[f.fact_key];
      if (balanceField) {
        period.balance[balanceField] = f.fact_value_num!;
        continue;
      }

      const cashflowField = CASHFLOW_MAP[f.fact_key];
      if (cashflowField) {
        period.cashflow[cashflowField] = f.fact_value_num!;
        continue;
      }
    }

    // Derive computed values
    deriveComputedValues(period);

    // Quality checks
    checkQuality(period);

    periods.push(period);
  }

  // Sort by period_end ascending
  periods.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

  // Period integrity assertions (dev/test safety net)
  if (process.env.NODE_ENV !== "production") {
    const seenIds = new Set<string>();
    for (const p of periods) {
      if (seenIds.has(p.periodId)) {
        throw new Error(`Duplicate period ID: ${p.periodId}`);
      }
      seenIds.add(p.periodId);
      const yr = Number(p.periodEnd.substring(0, 4));
      if (yr < 2000) {
        throw new Error(`Period year < 2000: ${p.periodEnd}`);
      }
    }
  }

  return { dealId, periods };
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

function deriveComputedValues(period: FinancialPeriod): void {
  const { income, balance, cashflow } = period;

  // EBITDA = revenue - cogs - operatingExpenses (+ depreciation add-back)
  if (income.revenue !== undefined) {
    const cogs = income.cogs ?? 0;
    const opex = income.operatingExpenses ?? 0;
    const depr = income.depreciation ?? 0;
    cashflow.ebitda = income.revenue - cogs - opex + depr;
  }

  // Equity = totalAssets - totalLiabilities (if not provided)
  if (balance.equity === undefined && balance.totalAssets !== undefined && balance.totalLiabilities !== undefined) {
    balance.equity = balance.totalAssets - balance.totalLiabilities;
  }

  // CFADS = EBITDA - capex (simplified Phase 1)
  if (cashflow.ebitda !== undefined) {
    const capex = cashflow.capex ?? 0;
    cashflow.cfads = cashflow.ebitda - capex;
  }
}

// ---------------------------------------------------------------------------
// Quality flags
// ---------------------------------------------------------------------------

function checkQuality(period: FinancialPeriod): void {
  const { income, balance } = period;

  // Flag if assets don't balance
  if (
    balance.totalAssets !== undefined &&
    balance.totalLiabilities !== undefined &&
    balance.equity !== undefined
  ) {
    const diff = Math.abs(balance.totalAssets - (balance.totalLiabilities + balance.equity));
    if (diff > 1) { // $1 tolerance for rounding
      period.qualityFlags.push("BALANCE_SHEET_IMBALANCE");
    }
  }

  // Flag negative revenue
  if (income.revenue !== undefined && income.revenue < 0) {
    period.qualityFlags.push("NEGATIVE_REVENUE");
  }

  // Flag missing key metrics
  if (income.revenue === undefined) {
    period.qualityFlags.push("MISSING_REVENUE");
  }
  if (balance.totalAssets === undefined) {
    period.qualityFlags.push("MISSING_TOTAL_ASSETS");
  }
}
