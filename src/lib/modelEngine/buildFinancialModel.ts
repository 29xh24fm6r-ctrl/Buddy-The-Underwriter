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
import { normalizeFactKey } from "@/lib/finengine/factKeyRegistry";

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
export const INCOME_PRIORITY: Record<string, IncomeSlot> = {
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
  // ── operating-expense line items (SPEC-FINENGINE-CANONICAL-FACT-BRIDGE-1) ─
  // Display-only detail lines (they do not feed EBITDA — TOTAL_OPERATING_EXPENSES
  // owns that). Fed from normalized source-line _IS keys so the standard spread's
  // expense rows populate instead of dashing.
  OFFICER_COMPENSATION:      { field: "officerComp", priority: 10 },
  PAYROLL:                   { field: "payroll", priority: 10 },
  RENT_EXPENSE:              { field: "rent", priority: 10 },
  REPAIRS_MAINTENANCE:       { field: "repairs", priority: 10 },
  INSURANCE_EXPENSE:         { field: "insurance", priority: 10 },
  ADVERTISING:               { field: "advertising", priority: 10 },
  UTILITIES:                 { field: "utilities", priority: 10 },
  PROFESSIONAL_FEES:         { field: "professionalFees", priority: 10 },
};

export const BALANCE_MAP: Record<string, keyof FinancialPeriod["balance"]> = {
  CASH_AND_EQUIVALENTS: "cash",
  ACCOUNTS_RECEIVABLE: "accountsReceivable",
  INVENTORY: "inventory",
  OTHER_CURRENT_ASSETS: "otherCurrentAssets",
  TOTAL_CURRENT_ASSETS: "totalCurrentAssets",
  TOTAL_ASSETS: "totalAssets",
  ACCOUNTS_PAYABLE: "accountsPayable",
  OTHER_CURRENT_LIABILITIES: "otherCurrentLiabilities",
  ACCRUED_LIABILITIES: "accruedLiabilities",
  TOTAL_CURRENT_LIABILITIES: "totalCurrentLiabilities",
  SHORT_TERM_DEBT: "shortTermDebt",
  LONG_TERM_DEBT: "longTermDebt",
  TOTAL_LIABILITIES: "totalLiabilities",
  TOTAL_EQUITY: "equity",
  RETAINED_EARNINGS: "retainedEarnings",
  COMMON_STOCK: "commonStock",
  PAID_IN_CAPITAL: "paidInCapital",
  // SPEC-FINENGINE-COMPLETE-DERIVATION-1: fixed-asset lines feed Net Fixed Assets.
  PPE_GROSS: "ppeGross",
  ACCUMULATED_DEPRECIATION: "accumulatedDepreciation",
  NET_FIXED_ASSETS: "netFixedAssets",
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

    // SPEC-FINENGINE-EXTRACTION-RECONCILIATION-1: QuickBooks balance sheets nest
    // Accounts Receivable UNDER "Other Current Assets," so the extractor emits
    // both SL_AR_GROSS and SL_OTHER_CURRENT_ASSETS with identical values —
    // double-counting Total Current Assets. When AR === OCA for the period,
    // suppress the OCA slot (AR is the real line; OCA is the redundant parent).
    const normalizedValues = new Map<string, number>();
    for (const f of sorted) {
      if (f.fact_value_num === null) continue;
      normalizedValues.set(normalizeFactKey(f.fact_key), f.fact_value_num);
    }
    const arValue = normalizedValues.get("ACCOUNTS_RECEIVABLE");
    const ocaValue = normalizedValues.get("OTHER_CURRENT_ASSETS");
    const suppressOca = arValue !== undefined && ocaValue !== undefined && arValue === ocaValue;

    // Distinct LONG_TERM_DEBT source values already summed this period. Multiple
    // Schedule L lines (L19 shareholder loans, L20 mortgages/notes) both map to
    // LONG_TERM_DEBT; sum DISTINCT values but de-dupe identical ones (the same
    // loan reported on two lines — e.g. 2023 both = $1,730,705).
    const ltdSeen = new Set<number>();

    for (const f of sorted) {
      // SPEC-FINENGINE-CANONICAL-FACT-BRIDGE-1: normalize extraction-vocabulary
      // keys (SL_CASH, SALARIES_WAGES_IS …) to canonical model keys ONCE, then
      // use the normalized key for every slot lookup.
      const key = normalizeFactKey(f.fact_key);

      const slot = INCOME_PRIORITY[key];
      if (slot) {
        const cur = fieldPriority[slot.field] ?? -1;
        if (slot.priority > cur) {
          period.income[slot.field] = f.fact_value_num!;
          fieldPriority[slot.field] = slot.priority;
        }
        continue;
      }

      const balanceField = BALANCE_MAP[key];
      if (balanceField) {
        // Suppress QuickBooks OCA double-count (SPEC-…-RECONCILIATION-1 §1b).
        if (balanceField === "otherCurrentAssets" && suppressOca) continue;
        // Accumulate long-term debt across distinct Schedule L lines (§1c).
        if (balanceField === "longTermDebt") {
          if (ltdSeen.has(f.fact_value_num!)) continue; // same loan on two lines
          ltdSeen.add(f.fact_value_num!);
          period.balance.longTermDebt = (period.balance.longTermDebt ?? 0) + f.fact_value_num!;
          continue;
        }
        period.balance[balanceField] = f.fact_value_num!;
        continue;
      }

      const cashflowField = CASHFLOW_MAP[key];
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

  // EBITDA derivation — prefer netIncome-based formula.
  // When operatingExpenses comes from TOTAL_DEDUCTIONS (tax returns), it
  // already includes depreciation and interest, so the old formula
  // (revenue - cogs - opex + depr) missed the interest add-back.
  // Correct formula: netIncome + depreciation + interest.
  if (income.netIncome !== undefined) {
    const dep = income.depreciation ?? 0;
    const ie  = income.interest ?? 0;
    cashflow.ebitda = income.netIncome + dep + ie;
  } else if (income.revenue !== undefined) {
    // Fallback: income statement data where operatingExpenses is pure OPEX
    // (excludes interest and depreciation). Add-backs are still required.
    const cogs = income.cogs ?? 0;
    const opex = income.operatingExpenses ?? 0;
    const dep  = income.depreciation ?? 0;
    const ie   = income.interest ?? 0;
    cashflow.ebitda = income.revenue - cogs - opex + dep + ie;
  }

  // SPEC-FINENGINE-COMPLETE-DERIVATION-1: comprehensive balance-sheet
  // derivations. Each fires ONLY when no raw fact supplied the value, so an
  // authoritative extracted aggregate always wins. Ordered so upstream subtotals
  // (net fixed assets, total liabilities) exist before the totals that need them.

  // ── Net Fixed Assets = PPE gross − accumulated depreciation ──────────
  if (balance.netFixedAssets === undefined
      && balance.ppeGross !== undefined
      && balance.accumulatedDepreciation !== undefined) {
    balance.netFixedAssets = balance.ppeGross - balance.accumulatedDepreciation;
  }

  // ── Total Non-Current Assets (net fixed assets; intangibles/LT receivables
  //    fold in once those fields are modeled) ──
  if (balance.totalNonCurrentAssets === undefined && balance.netFixedAssets !== undefined) {
    balance.totalNonCurrentAssets = balance.netFixedAssets;
  }

  // ── Current subtotals — OCA is already de-duped against AR upstream, so the
  //    sum never double-counts (SPEC-FINENGINE-EXTRACTION-RECONCILIATION-1 §1f) ──
  if (balance.totalCurrentAssets === undefined) {
    const tca = (balance.cash ?? 0) + (balance.accountsReceivable ?? 0)
      + (balance.inventory ?? 0) + (balance.otherCurrentAssets ?? 0);
    if (tca > 0) balance.totalCurrentAssets = tca;
  }
  // Current-liabilities component sum (AP + other-current + accrued + short-term).
  // shortTermDebt is a current liability and is included in the extracted
  // totalCurrentLiabilities subtotal by convention, so it is NOT re-added when
  // the subtotal branch is used for Total Liabilities below (SPEC-FIN-TL-1 R2).
  const clComponentSum = (balance.accountsPayable ?? 0) + (balance.otherCurrentLiabilities ?? 0)
    + (balance.accruedLiabilities ?? 0) + (balance.shortTermDebt ?? 0);

  // Whether the subtotal came in as an extracted raw fact, captured BEFORE we
  // backfill it from components — needed for the disagreement check below.
  const extractedCurrentLiabilities = balance.totalCurrentLiabilities;

  if (balance.totalCurrentLiabilities === undefined && clComponentSum > 0) {
    balance.totalCurrentLiabilities = clComponentSum;
  }

  // SPEC-FIN-TL-1 §3: when BOTH an extracted subtotal and a non-zero component
  // sum are present and they disagree materially, surface it. The chosen value
  // is still the subtotal (issuer-authored subtotal is authoritative); this only
  // records that extraction produced two inconsistent readings. Threshold mirrors
  // the small-value floor used elsewhere: max($1000, 5% × subtotal).
  if (extractedCurrentLiabilities !== undefined && clComponentSum > 0) {
    const delta = Math.abs(extractedCurrentLiabilities - clComponentSum);
    const materialThreshold = Math.max(1000, 0.05 * extractedCurrentLiabilities);
    if (delta > materialThreshold) {
      period.qualityFlags.push(
        "BALANCE_SHEET_SUBTOTAL_DISAGREEMENT:totalCurrentLiabilities" +
          `:subtotal=${extractedCurrentLiabilities}:components=${clComponentSum}` +
          `:delta=${delta}:chosen=subtotal`,
      );
    }
  }

  // ── Total Liabilities = current liabilities + long-term debt ──────────
  // SPEC-FIN-TL-1: prefer the extracted/resolved totalCurrentLiabilities subtotal
  // over re-summing itemized components. On a summarized balance sheet (Schedule L
  // shape) every itemized component is 0 and the old component-sum silently
  // collapsed Total Liabilities to just longTermDebt — understating leverage with
  // no imbalance flag, because equity is derived as assets − liabilities so the
  // balance identity held by construction. Long-term debt carries the Schedule L
  // shareholder-loan / mortgage lines and is added on top of current liabilities.
  if (balance.totalLiabilities === undefined) {
    const ltd = balance.longTermDebt ?? 0;
    if (balance.totalCurrentLiabilities !== undefined) {
      balance.totalLiabilities = balance.totalCurrentLiabilities + ltd;
    } else if (ltd > 0) {
      // Neither a current-liabilities subtotal nor components exist — Total
      // Liabilities is a floor (long-term debt only), not a complete figure.
      // Surface it so the memo does not read a partial TL as a clean fact.
      balance.totalLiabilities = ltd;
      period.qualityFlags.push("MISSING_CURRENT_LIABILITIES");
    }
    // else: no liabilities data at all → leave undefined (checkQuality flags).
  }

  // ── Net Worth = Total Assets − Total Liabilities ─────────────────────
  // Runs AFTER the Total Liabilities derivation above so it fires for periods
  // whose liabilities were assembled from components (not a single raw fact).
  if (balance.equity === undefined
      && balance.totalAssets !== undefined
      && balance.totalLiabilities !== undefined) {
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
