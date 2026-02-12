/**
 * Model Engine V2 — Parity Targets Mapping Layer
 *
 * Extracts canonical metrics from V1 spreads and V2 model engine
 * into a common PeriodMetricMap shape for comparison.
 *
 * Read-only. No DB mutation. No spread modification.
 */

import type { RenderedSpread } from "@/lib/financialSpreads/types";
import type { FinancialModel, FinancialPeriod } from "../types";
import { buildFinancialModel, type FactInput } from "../buildFinancialModel";
import { extractV1SpreadData } from "./compareV1toV2";
import type { V1SpreadData } from "./types";

// ---------------------------------------------------------------------------
// PeriodMetricMap — common shape for both V1 and V2
// ---------------------------------------------------------------------------

export interface PeriodMetrics {
  periodEnd?: string;
  metrics: Record<string, number | undefined>;
}

export type PeriodMetricMap = Record<string, PeriodMetrics>;

// ---------------------------------------------------------------------------
// Canonical metric keys for parity comparison
// ---------------------------------------------------------------------------

export const PARITY_METRIC_KEYS = [
  // Income Statement
  "revenue",
  "cogs",
  "operatingExpenses",
  "ebitda",
  "netIncome",
  // Balance Sheet
  "cash",
  "totalAssets",
  "totalLiabilities",
  "equity",
  // Derived
  "leverageDebtToEbitda",
] as const;

export type ParityMetricKey = (typeof PARITY_METRIC_KEYS)[number];

// ---------------------------------------------------------------------------
// V1 Spread row key → parity metric key
// ---------------------------------------------------------------------------

const V1_T12_METRIC_MAP: Record<string, ParityMetricKey> = {
  TOTAL_INCOME: "revenue",
  GROSS_RENTAL_INCOME: "revenue",
  TOTAL_OPEX: "operatingExpenses",
  NOI: "ebitda", // NOI is the RE equivalent of EBITDA in V1
  DEBT_SERVICE: "operatingExpenses", // not mapped — skip to avoid double-counting
};

const V1_BS_METRIC_MAP: Record<string, ParityMetricKey> = {
  CASH_AND_EQUIVALENTS: "cash",
  TOTAL_ASSETS: "totalAssets",
  TOTAL_LIABILITIES: "totalLiabilities",
  TOTAL_EQUITY: "equity",
};

// Override: NOI is closer to EBITDA for RE, but DEBT_SERVICE is not opex
// Remove DEBT_SERVICE mapping to avoid confusion
delete V1_T12_METRIC_MAP.DEBT_SERVICE;

// ---------------------------------------------------------------------------
// extractSpreadParityMetrics — read-only adapter for V1 spread data
// ---------------------------------------------------------------------------

export function extractSpreadParityMetricsFromData(
  v1Spreads: V1SpreadData[],
): PeriodMetricMap {
  const map: PeriodMetricMap = {};

  for (const spread of v1Spreads) {
    const mapping =
      spread.spreadType === "T12" ? V1_T12_METRIC_MAP
      : spread.spreadType === "BALANCE_SHEET" ? V1_BS_METRIC_MAP
      : null;
    if (!mapping) continue;

    for (const period of spread.periods) {
      if (!period.endDate || period.isAggregate) continue;

      if (!map[period.endDate]) {
        map[period.endDate] = { periodEnd: period.endDate, metrics: {} };
      }
      const pm = map[period.endDate];

      for (const row of spread.rows) {
        const metricKey = mapping[row.key];
        if (!metricKey) continue;
        const val = row.valueByPeriod[period.key];
        if (val !== null && val !== undefined) {
          pm.metrics[metricKey] = val;
        }
      }

      // Derive leverage if both totalDebt and ebitda available
      deriveLeverage(pm, spread);
    }
  }

  return map;
}

/**
 * DB-backed: loads V1 spreads from deal_spreads and extracts metrics.
 */
export async function extractSpreadParityMetrics(
  dealId: string,
  supabase: any,
): Promise<PeriodMetricMap> {
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

  return extractSpreadParityMetricsFromData(v1Spreads);
}

// ---------------------------------------------------------------------------
// extractModelV2ParityMetrics — V2 model engine adapter
// ---------------------------------------------------------------------------

export function extractModelV2ParityMetricsFromModel(
  model: FinancialModel,
): PeriodMetricMap {
  const map: PeriodMetricMap = {};

  for (const period of model.periods) {
    const pm: PeriodMetrics = { periodEnd: period.periodEnd, metrics: {} };

    // Income Statement
    if (period.income.revenue !== undefined) pm.metrics.revenue = period.income.revenue;
    if (period.income.cogs !== undefined) pm.metrics.cogs = period.income.cogs;
    if (period.income.operatingExpenses !== undefined) pm.metrics.operatingExpenses = period.income.operatingExpenses;
    if (period.income.netIncome !== undefined) pm.metrics.netIncome = period.income.netIncome;

    // Balance Sheet
    if (period.balance.cash !== undefined) pm.metrics.cash = period.balance.cash;
    if (period.balance.totalAssets !== undefined) pm.metrics.totalAssets = period.balance.totalAssets;
    if (period.balance.totalLiabilities !== undefined) pm.metrics.totalLiabilities = period.balance.totalLiabilities;
    if (period.balance.equity !== undefined) pm.metrics.equity = period.balance.equity;

    // EBITDA
    if (period.cashflow.ebitda !== undefined) pm.metrics.ebitda = period.cashflow.ebitda;

    // Leverage: total_debt / EBITDA
    const stDebt = period.balance.shortTermDebt ?? 0;
    const ltDebt = period.balance.longTermDebt ?? 0;
    const totalDebt = (period.balance.shortTermDebt !== undefined || period.balance.longTermDebt !== undefined)
      ? stDebt + ltDebt : undefined;
    if (totalDebt !== undefined && pm.metrics.ebitda !== undefined && pm.metrics.ebitda !== 0) {
      pm.metrics.leverageDebtToEbitda = totalDebt / pm.metrics.ebitda;
    }

    map[period.periodEnd] = pm;
  }

  return map;
}

/**
 * DB-backed: loads facts, builds V2 model, and extracts metrics.
 */
export async function extractModelV2ParityMetrics(
  dealId: string,
  supabase: any,
): Promise<PeriodMetricMap> {
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

  const model = buildFinancialModel(dealId, facts);
  return extractModelV2ParityMetricsFromModel(model);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveLeverage(pm: PeriodMetrics, spread: V1SpreadData): void {
  // V1 balance sheet may have SHORT_TERM_DEBT and LONG_TERM_DEBT
  if (spread.spreadType !== "BALANCE_SHEET") return;

  let stDebt: number | undefined;
  let ltDebt: number | undefined;
  for (const row of spread.rows) {
    if (row.key === "SHORT_TERM_DEBT") {
      for (const val of Object.values(row.valueByPeriod)) {
        if (val !== null) stDebt = val;
      }
    }
    if (row.key === "LONG_TERM_DEBT") {
      for (const val of Object.values(row.valueByPeriod)) {
        if (val !== null) ltDebt = val;
      }
    }
  }

  if ((stDebt !== undefined || ltDebt !== undefined) && pm.metrics.ebitda !== undefined && pm.metrics.ebitda !== 0) {
    const totalDebt = (stDebt ?? 0) + (ltDebt ?? 0);
    pm.metrics.leverageDebtToEbitda = totalDebt / pm.metrics.ebitda;
  }
}
