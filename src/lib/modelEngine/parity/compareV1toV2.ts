/**
 * Model Engine V2 — Parity Comparison Engine
 *
 * Read-only comparison of V1 spread data vs V2 model engine output.
 *
 * CONSTRAINTS:
 * - MUST NOT modify DB
 * - MUST NOT mutate lifecycle
 * - MUST NOT call persist
 * - MUST NOT touch renderers
 */

import type {
  RenderedSpread,
  RenderedSpreadCellV2,
  SpreadColumnV2,
} from "@/lib/financialSpreads/types";
import type { FinancialModel, FinancialPeriod } from "../types";
import { buildFinancialModel, type FactInput } from "../buildFinancialModel";
import { DEFAULT_THRESHOLDS } from "./thresholds";
import type {
  ParityComparison,
  ParityThresholds,
  PeriodAlignment,
  LineDiff,
  HeadlineDiff,
  ParityFlag,
  DiffStatus,
  DiffSection,
  V1SpreadData,
  V1PeriodColumn,
  V1RowData,
} from "./types";

// ---------------------------------------------------------------------------
// V1 row key → canonical comparison key
// ---------------------------------------------------------------------------

type CanonicalMapping = { key: string; section: DiffSection; label: string };

/** T12 / Income Statement rows → canonical */
const V1_T12_TO_CANONICAL: Record<string, CanonicalMapping> = {
  GROSS_RENTAL_INCOME: { key: "revenue", section: "income", label: "Revenue / Gross Rental Income" },
  TOTAL_INCOME:        { key: "revenue", section: "income", label: "Revenue / Total Income" },
  TOTAL_OPEX:          { key: "operating_expenses", section: "income", label: "Total Operating Expenses" },
  NOI:                 { key: "noi", section: "cashflow", label: "Net Operating Income" },
  CAPEX:               { key: "capex", section: "cashflow", label: "Capital Expenditures" },
  DEBT_SERVICE:        { key: "debt_service", section: "income", label: "Debt Service" },
  NET_CASH_FLOW_BEFORE_DEBT: { key: "ncf_before_debt", section: "cashflow", label: "Net Cash Flow Before Debt" },
};

/** Balance Sheet rows → canonical */
const V1_BS_TO_CANONICAL: Record<string, CanonicalMapping> = {
  CASH_AND_EQUIVALENTS:      { key: "cash", section: "balance", label: "Cash & Equivalents" },
  ACCOUNTS_RECEIVABLE:       { key: "accounts_receivable", section: "balance", label: "Accounts Receivable" },
  INVENTORY:                 { key: "inventory", section: "balance", label: "Inventory" },
  TOTAL_CURRENT_ASSETS:      { key: "current_assets", section: "balance", label: "Total Current Assets" },
  TOTAL_ASSETS:              { key: "total_assets", section: "balance", label: "Total Assets" },
  SHORT_TERM_DEBT:           { key: "short_term_debt", section: "balance", label: "Short-Term Debt" },
  LONG_TERM_DEBT:            { key: "long_term_debt", section: "balance", label: "Long-Term Debt" },
  TOTAL_CURRENT_LIABILITIES: { key: "current_liabilities", section: "balance", label: "Total Current Liabilities" },
  TOTAL_LIABILITIES:         { key: "total_liabilities", section: "balance", label: "Total Liabilities" },
  TOTAL_EQUITY:              { key: "equity", section: "balance", label: "Total Equity" },
};

/** Canonical key → human-readable label */
const CANONICAL_LABELS: Record<string, string> = {
  revenue: "Revenue",
  cogs: "Cost of Goods Sold",
  operating_expenses: "Operating Expenses",
  depreciation: "Depreciation",
  debt_service: "Debt Service",
  net_income: "Net Income",
  noi: "Net Operating Income",
  cash: "Cash & Equivalents",
  accounts_receivable: "Accounts Receivable",
  inventory: "Inventory",
  current_assets: "Total Current Assets",
  total_assets: "Total Assets",
  short_term_debt: "Short-Term Debt",
  long_term_debt: "Long-Term Debt",
  current_liabilities: "Total Current Liabilities",
  total_liabilities: "Total Liabilities",
  equity: "Total Equity",
  ebitda: "EBITDA",
  capex: "Capital Expenditures",
  cfads: "CFADS",
  total_debt: "Total Debt",
  leverage: "Leverage (Debt/EBITDA)",
  ncf_before_debt: "Net Cash Flow Before Debt",
};

/** Headline metrics to always report */
const HEADLINE_METRICS = ["revenue", "ebitda", "equity", "total_debt", "leverage"];

// ---------------------------------------------------------------------------
// V2 period → canonical values
// ---------------------------------------------------------------------------

function extractV2Canonical(period: FinancialPeriod): Record<string, number | null> {
  const c: Record<string, number | null> = {};

  // Income
  if (period.income.revenue !== undefined) c.revenue = period.income.revenue;
  if (period.income.cogs !== undefined) c.cogs = period.income.cogs;
  if (period.income.operatingExpenses !== undefined) c.operating_expenses = period.income.operatingExpenses;
  if (period.income.depreciation !== undefined) c.depreciation = period.income.depreciation;
  if (period.income.interest !== undefined) c.debt_service = period.income.interest;
  if (period.income.netIncome !== undefined) c.net_income = period.income.netIncome;

  // Balance
  if (period.balance.cash !== undefined) c.cash = period.balance.cash;
  if (period.balance.accountsReceivable !== undefined) c.accounts_receivable = period.balance.accountsReceivable;
  if (period.balance.inventory !== undefined) c.inventory = period.balance.inventory;
  if (period.balance.totalAssets !== undefined) c.total_assets = period.balance.totalAssets;
  if (period.balance.shortTermDebt !== undefined) c.short_term_debt = period.balance.shortTermDebt;
  if (period.balance.longTermDebt !== undefined) c.long_term_debt = period.balance.longTermDebt;
  if (period.balance.totalLiabilities !== undefined) c.total_liabilities = period.balance.totalLiabilities;
  if (period.balance.equity !== undefined) c.equity = period.balance.equity;

  // Cashflow
  if (period.cashflow.ebitda !== undefined) c.ebitda = period.cashflow.ebitda;
  if (period.cashflow.capex !== undefined) c.capex = period.cashflow.capex;
  if (period.cashflow.cfads !== undefined) c.cfads = period.cashflow.cfads;

  // Derived headline: total_debt, leverage
  const stDebt = period.balance.shortTermDebt ?? 0;
  const ltDebt = period.balance.longTermDebt ?? 0;
  if (period.balance.shortTermDebt !== undefined || period.balance.longTermDebt !== undefined) {
    c.total_debt = stDebt + ltDebt;
  }
  if (c.ebitda != null && c.ebitda !== 0 && c.total_debt != null) {
    c.leverage = c.total_debt / c.ebitda;
  }

  return c;
}

// ---------------------------------------------------------------------------
// V1 rendered spread → normalized V1SpreadData
// ---------------------------------------------------------------------------

const AGGREGATE_KINDS = new Set(["ttm", "ytd", "prior_ytd"]);

export function extractV1SpreadData(spread: RenderedSpread): V1SpreadData {
  const spreadType = spread.spread_type ?? "UNKNOWN";

  // Extract period columns
  const periods: V1PeriodColumn[] = [];
  if (spread.columnsV2 && spread.columnsV2.length > 0) {
    for (const col of spread.columnsV2) {
      periods.push({
        key: col.key,
        label: col.label,
        endDate: col.end_date ?? null,
        isAggregate: AGGREGATE_KINDS.has(col.kind),
      });
    }
  } else {
    // Schema v1/v2: columns are string labels, no metadata
    for (const colLabel of spread.columns) {
      periods.push({
        key: colLabel,
        label: colLabel,
        endDate: inferEndDateFromLabel(colLabel),
        isAggregate: /^(TTM|YTD|PY.YTD)$/i.test(colLabel),
      });
    }
  }

  // Extract rows
  const rows: V1RowData[] = [];
  for (const row of spread.rows) {
    if (row.notes === "section_header") continue;

    const valueByPeriod: Record<string, number | null> = {};
    for (const period of periods) {
      valueByPeriod[period.key] = extractCellValue(
        row,
        period.key,
        spread.columns,
      );
    }

    rows.push({
      key: row.key,
      label: row.label,
      section: row.section ?? null,
      valueByPeriod,
    });
  }

  return { spreadType, periods, rows };
}

function extractCellValue(
  row: RenderedSpread["rows"][number],
  columnKey: string,
  columns: string[],
): number | null {
  if (!row.values || row.values.length === 0) return null;

  const cell = row.values[0];

  // Schema v3: RenderedSpreadCellV2 with valueByCol
  if (cell !== null && typeof cell === "object" && "valueByCol" in cell) {
    const v2Cell = cell as RenderedSpreadCellV2;
    if (v2Cell.valueByCol) {
      const v = v2Cell.valueByCol[columnKey];
      return typeof v === "number" ? v : null;
    }
  }

  // Schema v1/v2: positional
  const colIdx = columns.indexOf(columnKey);
  if (colIdx >= 0 && colIdx < row.values.length) {
    const v = row.values[colIdx];
    if (typeof v === "number") return v;
    return null;
  }

  return null;
}

function inferEndDateFromLabel(label: string): string | null {
  const MONTHS: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const m = label.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  const year = m[2];
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  return `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Pure comparison: V1SpreadData[] + V2 FinancialModel → ParityComparison
// ---------------------------------------------------------------------------

export function compareModels(
  dealId: string,
  v1Spreads: V1SpreadData[],
  v2Model: FinancialModel,
  thresholds: ParityThresholds = DEFAULT_THRESHOLDS,
): ParityComparison {
  // Collect non-aggregate V1 periods by endDate
  const v1Periods = new Map<string, V1PeriodColumn>();
  for (const spread of v1Spreads) {
    for (const p of spread.periods) {
      if (p.endDate && !p.isAggregate && !v1Periods.has(p.endDate)) {
        v1Periods.set(p.endDate, p);
      }
    }
  }

  const v2Periods = new Map<string, FinancialPeriod>();
  for (const p of v2Model.periods) {
    v2Periods.set(p.periodEnd, p);
  }

  // Align periods
  const allPeriodEnds = new Set([...v1Periods.keys(), ...v2Periods.keys()]);
  const periods: PeriodAlignment[] = [];
  for (const pe of [...allPeriodEnds].sort()) {
    const v1Col = v1Periods.get(pe);
    const v2Period = v2Periods.get(pe);
    periods.push({
      periodEnd: pe,
      v1Label: v1Col?.label ?? null,
      v1ColumnKey: v1Col?.key ?? null,
      v2PeriodEnd: v2Period?.periodEnd ?? null,
      aligned: !!v1Col && !!v2Period,
      source: v1Col && v2Period ? "both" : v1Col ? "v1_only" : "v2_only",
    });
  }

  // Build canonical V1 values per period
  const v1CanonByPeriod = new Map<string, Record<string, number | null>>();
  for (const spread of v1Spreads) {
    const mapping =
      spread.spreadType === "T12" ? V1_T12_TO_CANONICAL
      : spread.spreadType === "BALANCE_SHEET" ? V1_BS_TO_CANONICAL
      : null;
    if (!mapping) continue;

    for (const period of spread.periods) {
      if (!period.endDate || period.isAggregate) continue;

      if (!v1CanonByPeriod.has(period.endDate)) {
        v1CanonByPeriod.set(period.endDate, {});
      }
      const canon = v1CanonByPeriod.get(period.endDate)!;

      for (const row of spread.rows) {
        const map = mapping[row.key];
        if (!map) continue;
        const val = row.valueByPeriod[period.key] ?? null;
        if (val !== null) canon[map.key] = val;
      }
    }

    // Derive V1 total_debt for headline comparison
    for (const [, canon] of v1CanonByPeriod) {
      if (canon.short_term_debt != null || canon.long_term_debt != null) {
        canon.total_debt = (canon.short_term_debt ?? 0) + (canon.long_term_debt ?? 0);
      }
    }
  }

  const diffs: LineDiff[] = [];
  const headline: HeadlineDiff[] = [];
  const flags: ParityFlag[] = [];

  for (const pa of periods) {
    if (pa.source === "v1_only") {
      flags.push({
        type: "missing_period",
        detail: `Period ${pa.periodEnd} exists in V1 but not in V2`,
        severity: "error",
      });
      continue;
    }
    if (pa.source === "v2_only") {
      flags.push({
        type: "missing_period",
        detail: `Period ${pa.periodEnd} exists in V2 but not in V1`,
        severity: "warning",
      });
      continue;
    }

    // Both sides have this period — compare
    const v1Canon = v1CanonByPeriod.get(pa.periodEnd) ?? {};
    const v2Period = v2Periods.get(pa.periodEnd)!;
    const v2Canon = extractV2Canonical(v2Period);

    // Line diffs for all canonical keys present in either side
    const allKeys = new Set([...Object.keys(v1Canon), ...Object.keys(v2Canon)]);
    for (const key of allKeys) {
      const v1Val = key in v1Canon ? v1Canon[key] : null;
      const v2Val = key in v2Canon ? v2Canon[key] : null;

      const diff = computeDiff(v1Val, v2Val, thresholds.lineItemTolerance);
      diffs.push({
        section: inferSection(key),
        key,
        label: CANONICAL_LABELS[key] ?? key,
        periodEnd: pa.periodEnd,
        v1Value: v1Val,
        v2Value: v2Val,
        absDiff: diff.absDiff,
        pctDiff: diff.pctDiff,
        status: diff.status,
      });

      detectLineFlags(key, v1Val, v2Val, diff.status, pa.periodEnd, flags);
    }

    // Headline metrics
    for (const metric of HEADLINE_METRICS) {
      const v1Val = v1Canon[metric] ?? null;
      const v2Val = v2Canon[metric] ?? null;
      const diff = computeDiff(v1Val, v2Val, thresholds.headlineAbsTolerance);

      // v1_only / v2_only = coverage gap, not parity failure.
      // Only "mismatch" (both sides have a value that differs) fails.
      const withinTolerance =
        diff.status === "match" ||
        diff.status === "both_null" ||
        diff.status === "v1_only" ||
        diff.status === "v2_only" ||
        (diff.absDiff !== null && diff.absDiff <= thresholds.headlineAbsTolerance) ||
        (diff.pctDiff !== null && Math.abs(diff.pctDiff) <= thresholds.headlinePctTolerance);

      headline.push({
        metric,
        periodEnd: pa.periodEnd,
        v1Value: v1Val,
        v2Value: v2Val,
        absDiff: diff.absDiff,
        pctDiff: diff.pctDiff,
        withinTolerance,
      });
    }
  }

  // Determine pass/fail
  const hasFailingPeriod =
    thresholds.missingPeriodFails &&
    flags.some((f) => f.type === "missing_period" && f.severity === "error");
  const hasHeadlineFailure = headline.some((h) => !h.withinTolerance);
  const hasLineMismatch = diffs.some((d) => d.status === "mismatch");
  const hasErrorFlag = flags.some((f) => f.severity === "error");

  const passFail =
    hasFailingPeriod || hasHeadlineFailure || hasLineMismatch || hasErrorFlag
      ? "FAIL"
      : "PASS";

  return { dealId, periods, diffs, headline, flags, passFail, thresholdsUsed: thresholds };
}

// ---------------------------------------------------------------------------
// DB-backed comparison (read-only)
// ---------------------------------------------------------------------------

export async function compareV1toV2(
  dealId: string,
  supabase: any,
  thresholds: ParityThresholds = DEFAULT_THRESHOLDS,
): Promise<ParityComparison> {
  // 1. Load V1 spreads (read-only)
  const { data: spreads } = await supabase
    .from("deal_spreads")
    .select("spread_type, rendered_json, owner_type")
    .eq("deal_id", dealId)
    .in("spread_type", ["T12", "BALANCE_SHEET"])
    .eq("owner_type", "DEAL");

  const v1Spreads: V1SpreadData[] = [];
  if (spreads) {
    for (const row of spreads as any[]) {
      if (row.rendered_json) {
        v1Spreads.push(extractV1SpreadData(row.rendered_json as RenderedSpread));
      }
    }
  }

  // 2. Load facts and build V2 model (read-only, no persist)
  const { data: rawFacts } = await supabase
    .from("deal_financial_facts")
    .select("fact_type, fact_key, fact_value_num, fact_period_end, confidence")
    .eq("deal_id", dealId);

  const facts: FactInput[] = (rawFacts ?? []).map((f: any) => ({
    fact_type: f.fact_type,
    fact_key: f.fact_key,
    fact_value_num: f.fact_value_num !== null ? Number(f.fact_value_num) : null,
    fact_period_end: f.fact_period_end,
    confidence: f.confidence !== null ? Number(f.confidence) : null,
  }));

  const v2Model = buildFinancialModel(dealId, facts);

  // 3. Pure comparison
  return compareModels(dealId, v1Spreads, v2Model, thresholds);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeDiff(
  v1: number | null,
  v2: number | null,
  tolerance: number,
): { absDiff: number | null; pctDiff: number | null; status: DiffStatus } {
  if (v1 === null && v2 === null) {
    return { absDiff: null, pctDiff: null, status: "both_null" };
  }
  if (v1 === null) return { absDiff: null, pctDiff: null, status: "v2_only" };
  if (v2 === null) return { absDiff: null, pctDiff: null, status: "v1_only" };

  const absDiff = Math.abs(v1 - v2);
  const pctDiff = v1 !== 0 ? (v2 - v1) / Math.abs(v1) : v2 !== 0 ? Infinity : 0;
  const status: DiffStatus = absDiff <= tolerance ? "match" : "mismatch";

  return { absDiff, pctDiff, status };
}

function detectLineFlags(
  key: string,
  v1Val: number | null,
  v2Val: number | null,
  status: DiffStatus,
  periodEnd: string,
  flags: ParityFlag[],
): void {
  const label = CANONICAL_LABELS[key] ?? key;

  if (status === "v1_only") {
    flags.push({ type: "missing_row", detail: `${label} missing in V2 for ${periodEnd}`, severity: "warning" });
  }
  if (status === "v2_only") {
    flags.push({ type: "missing_row", detail: `${label} missing in V1 for ${periodEnd}`, severity: "warning" });
  }

  if (v1Val !== null && v2Val !== null) {
    // Sign flip
    if ((v1Val > 0 && v2Val < 0) || (v1Val < 0 && v2Val > 0)) {
      flags.push({ type: "sign_flip", detail: `${label}: V1=${v1Val}, V2=${v2Val} for ${periodEnd}`, severity: "error" });
    }
    // Scaling error (~1000x)
    if (v1Val !== 0 && v2Val !== 0) {
      const ratio = Math.abs(v1Val / v2Val);
      if ((ratio > 900 && ratio < 1100) || (ratio > 0.0009 && ratio < 0.0011)) {
        flags.push({ type: "scaling_error", detail: `${label}: V1=${v1Val} vs V2=${v2Val} (~1000x) for ${periodEnd}`, severity: "error" });
      }
    }
    // Zero-filled
    if (v1Val === 0 && v2Val !== 0) {
      flags.push({ type: "zero_filled", detail: `${label}: V1=0 but V2=${v2Val} for ${periodEnd}`, severity: "warning" });
    }
    if (v2Val === 0 && v1Val !== 0) {
      flags.push({ type: "zero_filled", detail: `${label}: V2=0 but V1=${v1Val} for ${periodEnd}`, severity: "warning" });
    }
  }
}

function inferSection(key: string): DiffSection {
  const BALANCE_KEYS = new Set([
    "cash", "accounts_receivable", "inventory", "current_assets", "total_assets",
    "short_term_debt", "long_term_debt", "current_liabilities", "total_liabilities",
    "equity", "total_debt",
  ]);
  const CASHFLOW_KEYS = new Set([
    "ebitda", "capex", "cfads", "noi", "ncf_before_debt", "leverage",
  ]);
  if (BALANCE_KEYS.has(key)) return "balance";
  if (CASHFLOW_KEYS.has(key)) return "cashflow";
  return "income";
}
