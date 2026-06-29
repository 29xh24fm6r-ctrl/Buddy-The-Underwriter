/**
 * SPEC-FINENGINE-LIVE-SPREAD-1 — Phase 2: computeDealSpread.
 *
 * Pure orchestration over the Phase 1 certified snapshots: for each (entity
 * scope, period) it maps the certified facts to the canonical view, runs the
 * EBITDA method and every metric module, and attaches interpret() to each.
 * Multi-period metrics (turnover averages, returns, trend, growth, CAGR) consume
 * the ordered period series. Still read-only (NG1) — writes no canonical fact;
 * the DealSpread lives in memory / the Phase 3 report.
 */

import type { SpreadInputs } from "@/lib/finengine/contracts";
import {
  buildCertifiedSnapshots,
  SENTINEL_PERIOD,
  type CertifiedFactRow,
  type CertifiedPeriodSnapshot,
  type EntityScope,
} from "@/lib/finengine/shadow/dealInputAdapter";
import { canonicalView, type CanonicalInputs } from "@/lib/finengine/spread/factViews";
import type { IndustryProfile } from "@/lib/industryIntelligence/types";
import { coreOperatingEarnings } from "@/lib/finengine/methods/foundation";
import { interpret, type Interpretation, type AccountingBasis } from "@/lib/finengine/metrics/interpret";
import * as M from "@/lib/finengine/metrics";

export type MetricCell = {
  family: string;
  metric: string;
  scope: EntityScope;
  period: string; // 'YYYY-MM-DD' or 'SERIES' for multi-period
  value: number | null;
  rating: Interpretation["rating"];
  interpretation: Interpretation;
  inputs: Record<string, number>;
  sourceKeys: string[];
};

export type DealSpread = {
  dealId: string;
  scopes: EntityScope[];
  snapshots: CertifiedPeriodSnapshot[];
  cells: MetricCell[];
  warnings: string[];
};

type ResultLike = { metric: string; value?: number | null; inputs?: Record<string, number>; zone?: string; driver?: string | null };

function isReal(period: string): boolean {
  return period !== SENTINEL_PERIOD;
}

/** Build a cell from any result carrying a metric name, attaching its interpretation. */
function cell(family: string, result: ResultLike, scope: EntityScope, period: string, sourceKeys: string[], accountingBasis?: AccountingBasis): MetricCell {
  const interpretation = interpret(result, accountingBasis ? { accountingBasis } : undefined);
  return {
    family, metric: result.metric, scope, period,
    value: result.value ?? null,
    rating: interpretation.rating,
    interpretation,
    inputs: result.inputs ?? {},
    sourceKeys: sourceKeys.filter(Boolean),
  };
}

/** Keys (from the canonical-view src map) that fed a set of canonical fields. */
function keysFor(srcMap: Record<string, string>, fields: string[]): string[] {
  return fields.map((f) => srcMap[f]).filter((k): k is string => !!k);
}

function pushReal(cells: MetricCell[], c: MetricCell): void {
  // Reconciliation (legit 0), method EBITDA, and distress scores are always
  // informative; everything else is emitted only when it computed a value.
  const alwaysKeep = c.metric === "NET_WORTH_RECONCILIATION" || c.family === "method" || c.family === "distress";
  if (c.value != null || alwaysKeep) cells.push(c);
}

/** Single-period metrics from one canonical view. */
function singlePeriodCells(view: ReturnType<typeof canonicalView>, snap: CertifiedPeriodSnapshot): MetricCell[] {
  const { v, src } = view;
  const scope = snap.entityScope, period = snap.fiscalPeriodEnd;
  const basis = snap.accountingBasis;
  const s = src as Record<string, string>;
  const out: MetricCell[] = [];
  const add = (family: string, r: ResultLike, fields: string[]) => pushReal(out, cell(family, r, scope, period, keysFor(s, fields), basis));

  // EBITDA method (the real engine).
  const inputs: SpreadInputs = { facts: snap.facts, entityForm: "UNKNOWN", fiscalPeriodEnd: period };
  const core = coreOperatingEarnings(inputs);
  add("method", { metric: "EBITDA", value: core.value, inputs: { base: core.base.value ?? 0, interest: core.interest, depAmort: core.depAmort } }, ["pretaxIncome", "interestExpense", "depreciation"]);

  // Liquidity
  const nwc = M.netWorkingCapital(v.currentAssets, v.currentLiabilities);
  add("liquidity", M.currentRatio(v.currentAssets, v.currentLiabilities), ["currentAssets", "currentLiabilities"]);
  add("liquidity", M.quickRatio(v.currentAssets, v.inventory, v.currentLiabilities), ["currentAssets", "inventory", "currentLiabilities"]);
  add("liquidity", M.cashRatio(v.cash, v.currentLiabilities), ["cash", "currentLiabilities"]);
  add("liquidity", nwc, ["currentAssets", "currentLiabilities"]);
  add("liquidity", M.workingCapitalToSales(nwc.value, v.revenue), ["currentAssets", "currentLiabilities", "revenue"]);

  // Leverage / solvency
  add("leverage", M.debtToEquity(v.totalLiabilities, v.equity), ["totalLiabilities", "equity"]);
  add("leverage", M.debtToWorth(v.totalLiabilities, v.equity), ["totalLiabilities", "equity"]);
  add("leverage", M.debtToAssets(v.fundedDebt, v.totalAssets), ["fundedDebt", "totalAssets"]);
  add("leverage", M.liabilitiesToAssets(v.totalLiabilities, v.totalAssets), ["totalLiabilities", "totalAssets"]);
  add("leverage", M.debtToCapital(v.fundedDebt, v.equity), ["fundedDebt", "equity"]);
  add("leverage", M.equityRatio(v.equity, v.totalAssets), ["equity", "totalAssets"]);
  add("leverage", M.equityMultiplier(v.totalAssets, v.equity), ["totalAssets", "equity"]);

  // Profitability (margins)
  add("profitability", M.grossMargin(v.grossProfit, v.revenue), ["grossProfit", "revenue"]);
  add("profitability", M.operatingMargin(v.operatingIncome ?? v.ebit, v.revenue), ["operatingIncome", "ebit", "revenue"]);
  add("profitability", M.netMargin(v.netIncome, v.revenue), ["netIncome", "revenue"]);
  add("profitability", M.pretaxMargin(v.pretaxIncome, v.revenue), ["pretaxIncome", "revenue"]);
  add("profitability", M.operatingExpenseRatio(v.operatingExpenses, v.revenue), ["operatingExpenses", "revenue"]);

  // Days metrics (single-period stock ÷ flow)
  add("activity", M.daysSalesOutstanding(v.accountsReceivable, v.revenue), ["accountsReceivable", "revenue"]);
  add("activity", M.daysInventoryOnHand(v.inventory, v.cogs), ["inventory", "cogs"]);
  add("activity", M.daysPayableOutstanding(v.accountsPayable, v.cogs), ["accountsPayable", "cogs"]);

  // Balance-sheet adjustments
  const tnw = M.tangibleNetWorth(v.equity, v.intangibles);
  const etnw = M.effectiveTangibleNetWorth({ bookNetWorth: v.equity, intangibles: v.intangibles });
  add("adjustments", tnw, ["equity", "intangibles"]);
  add("adjustments", etnw, ["equity", "intangibles"]);
  add("adjustments", M.debtToEffectiveTNW(v.totalLiabilities, 0, etnw.value), ["totalLiabilities", "equity", "intangibles"]);
  add("adjustments", M.fixedAssetAge(v.accumDepreciation, v.ppeGross), ["accumDepreciation", "ppeGross"]);
  add("adjustments", M.netToGrossPPE(v.ppeNet, v.ppeGross), ["ppeNet", "ppeGross"]);
  add("adjustments", M.netWorthReconciliation({ beginningEquity: v.beginningEquity, netIncome: v.netIncome, reportedDistributions: v.distributions, endingEquity: v.endingEquity }), ["beginningEquity", "netIncome", "distributions", "endingEquity"]);

  // Distress (Altman private variants)
  const altInputs = { workingCapital: nwc.value, retainedEarnings: v.retainedEarnings, ebit: v.ebit, totalAssets: v.totalAssets, bookEquity: v.equity, totalLiabilities: v.totalLiabilities, sales: v.revenue };
  const zp = M.altmanZPrime(altInputs), zpp = M.altmanZDoublePrime(altInputs);
  pushReal(out, cell("distress", { metric: zp.metric, value: zp.score, inputs: zp.inputs, zone: zp.zone }, scope, period, keysFor(s, ["currentAssets", "retainedEarnings", "ebit", "totalAssets", "equity", "totalLiabilities", "revenue"])));
  pushReal(out, cell("distress", { metric: zpp.metric, value: zpp.score, inputs: zpp.inputs, zone: zpp.zone }, scope, period, keysFor(s, ["currentAssets", "retainedEarnings", "ebit", "totalAssets", "equity", "totalLiabilities"])));

  // Structural (vertical) — common-size income
  add("structural", M.commonSizeIncome({ cogs: v.cogs, grossProfit: v.grossProfit, operatingIncome: v.operatingIncome, netIncome: v.netIncome }, v.revenue), ["revenue"]);

  return out;
}

/** Multi-period metrics from the ordered business series (turnover averages, returns, trend, growth). */
function multiPeriodCells(scope: EntityScope, series: Array<{ period: string; v: CanonicalInputs; basis: AccountingBasis }>): MetricCell[] {
  const out: MetricCell[] = [];
  // Per-period basis conditions the accrual-dependent turnover metrics; SERIES-level
  // trend/CAGR span periods and aren't accrual-dependent, so they pass no basis.
  const mk = (family: string, r: ResultLike, period: string, basis?: AccountingBasis) =>
    pushReal(out, cell(family, r, scope, period, [], basis));

  // Turnover + returns: each period i uses (prior, current) average balances.
  for (let i = 1; i < series.length; i++) {
    const cur = series[i].v, prior = series[i - 1].v, period = series[i].period, basis = series[i].basis;
    mk("activity", M.arTurnover(cur.revenue, prior.accountsReceivable, cur.accountsReceivable), period, basis);
    mk("activity", M.inventoryTurnover(cur.cogs, prior.inventory, cur.inventory), period, basis);
    mk("activity", M.apTurnover(cur.cogs, prior.accountsPayable, cur.accountsPayable), period, basis);
    mk("activity", M.assetTurnover(cur.revenue, prior.totalAssets, cur.totalAssets), period, basis);
    mk("profitability", M.returnOnAssets(cur.netIncome, prior.totalAssets, cur.totalAssets), period, basis);
    mk("profitability", M.returnOnEquity(cur.netIncome, prior.equity, cur.equity), period, basis);
    mk("structural", M.growthYoY(cur.revenue, prior.revenue), period, basis);
    mk("structural", M.growthYoY(cur.netIncome, prior.netIncome), period, basis);
  }

  // Trend + CAGR over the whole revenue series.
  if (series.length >= 2) {
    const revSeries = series.map((s) => ({ period: s.period, value: s.v.revenue }));
    mk("structural", M.trend(revSeries), "SERIES");
    const first = series[0].v.revenue, last = series[series.length - 1].v.revenue;
    mk("structural", M.cagr(first, last, series.length - 1), "SERIES");
  }

  return out;
}

/**
 * SPEC-FINENGINE-KNOWLEDGE-WIRE-2 (2d) — when a scope's determinable accounting
 * basis is not constant across its periods, period-over-period AR/AP/working-
 * capital trends are not comparable. Only determinable bases (CASH/ACCRUAL/OTHER)
 * count — an UNKNOWN period is missing capture, not a basis change. One warning.
 */
function basisChangeWarning(scope: EntityScope, series: Array<{ basis: AccountingBasis }>): string | null {
  const determinable = new Set(series.map((s) => s.basis).filter((b) => b !== "UNKNOWN"));
  if (determinable.size < 2) return null;
  return `[${scope}] accounting basis changes across periods (${[...determinable].join(" → ")}) — period-over-period trends in AR/AP/working capital are not comparable.`;
}

/**
 * Compute the full deal spread from certified facts. Pure: the runner loads the
 * richer rows and passes them here. Read-only (NG1).
 */
export function computeDealSpread(dealId: string, rows: CertifiedFactRow[], opts?: { scopes?: EntityScope[]; industry?: IndustryProfile }): DealSpread {
  const snapshots = buildCertifiedSnapshots(dealId, rows, opts ? { scopes: opts.scopes, industry: opts.industry } : undefined);
  const scopes = [...new Set(snapshots.map((s) => s.entityScope))];
  const cells: MetricCell[] = [];
  const warnings: string[] = [];

  // Single-period metrics for every snapshot.
  const viewsByScope = new Map<EntityScope, Array<{ period: string; v: CanonicalInputs; basis: AccountingBasis }>>();
  for (const snap of snapshots) {
    const view = canonicalView(snap.facts);
    cells.push(...singlePeriodCells(view, snap));
    if (isReal(snap.fiscalPeriodEnd)) {
      const arr = viewsByScope.get(snap.entityScope) ?? [];
      arr.push({ period: snap.fiscalPeriodEnd, v: view.v, basis: snap.accountingBasis });
      viewsByScope.set(snap.entityScope, arr);
    }
    warnings.push(...snap.warnings.map((w) => `[${snap.entityScope} ${snap.fiscalPeriodEnd}] ${w}`));
  }

  // Multi-period metrics per scope (chronological real periods only).
  for (const [scope, arr] of viewsByScope) {
    const ordered = arr.filter((a) => isReal(a.period)).sort((a, b) => (a.period < b.period ? -1 : 1));
    cells.push(...multiPeriodCells(scope, ordered));
    const basisWarn = basisChangeWarning(scope, ordered);
    if (basisWarn) warnings.push(basisWarn);
  }

  return { dealId, scopes, snapshots, cells, warnings };
}

/** Convenience: cells for one scope grouped by family (for the Phase 3 report). */
export function cellsByFamily(spread: DealSpread, scope: EntityScope): Record<string, MetricCell[]> {
  const out: Record<string, MetricCell[]> = {};
  for (const c of spread.cells) {
    if (c.scope !== scope) continue;
    (out[c.family] ??= []).push(c);
  }
  return out;
}
