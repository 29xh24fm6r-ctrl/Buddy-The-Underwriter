import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { RenderedSpread, SpreadType } from "@/lib/financialSpreads/types";
import { CANONICAL_FACTS } from "@/lib/financialFacts/keys";

export type MetricSource = {
  source: string;
  updated_at: string | null;
};

export type MetricValue = MetricSource & {
  value: number | null;
};

export type SpreadSnapshot = {
  spread_type: string;
  status: string;
  updated_at: string | null;
  rendered_json: RenderedSpread | null;
};

const REQUIRED_SPREADS: SpreadType[] = ["GLOBAL_CASH_FLOW"];

export type RequiredMetric = {
  key: string;
  label: string;
  metric: MetricValue;
};

const FACT = {
  COLLATERAL: {
    type: "COLLATERAL",
    keys: {
      AS_IS_VALUE: "AS_IS_VALUE",
      STABILIZED_VALUE: "STABILIZED_VALUE",
      GROSS_VALUE: CANONICAL_FACTS.COLLATERAL_GROSS_VALUE.fact_key,
      NET_VALUE: CANONICAL_FACTS.COLLATERAL_NET_VALUE.fact_key,
      DISCOUNTED_VALUE: CANONICAL_FACTS.COLLATERAL_DISCOUNTED_VALUE.fact_key,
    },
  },
  FINANCIAL_ANALYSIS: {
    type: "FINANCIAL_ANALYSIS",
    keys: {
      CASH_FLOW_AVAILABLE: CANONICAL_FACTS.CASH_FLOW_AVAILABLE.fact_key,
      ANNUAL_DEBT_SERVICE: CANONICAL_FACTS.ANNUAL_DEBT_SERVICE.fact_key,
      ANNUAL_DEBT_SERVICE_STRESSED_300BPS: "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
      DSCR: CANONICAL_FACTS.DSCR.fact_key,
      DSCR_STRESSED_300BPS: CANONICAL_FACTS.DSCR_STRESSED_300BPS.fact_key,
    },
  },
  SOURCES_USES: {
    type: "SOURCES_USES",
    keys: {
      TOTAL_PROJECT_COST: CANONICAL_FACTS.TOTAL_PROJECT_COST.fact_key,
      BORROWER_EQUITY: CANONICAL_FACTS.BORROWER_EQUITY.fact_key,
      BANK_LOAN_TOTAL: CANONICAL_FACTS.BANK_LOAN_TOTAL.fact_key,
    },
  },
} as const;

function norm(s: string) {
  return s.trim().toLowerCase();
}

function cellToNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "value" in v) {
    const inner = (v as any).value;
    if (typeof inner === "number" && Number.isFinite(inner)) return inner;
  }
  return null;
}

function pendingMetric(): MetricValue {
  return { value: null, source: "Pending", updated_at: null };
}

function maxIsoTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function maxIsoTimestamps(...dates: Array<string | null | undefined>): string | null {
  let out: string | null = null;
  for (const d of dates) {
    out = maxIsoTimestamp(out, d ?? null);
  }
  return out;
}

async function metricFromFactNum(args: {
  dealId: string;
  bankId: string;
  factType: string;
  factKey: string;
  sourcePrefix?: string;
}): Promise<MetricValue> {
  const row = await getLatestFactNum({
    dealId: args.dealId,
    bankId: args.bankId,
    factType: args.factType,
    factKey: args.factKey,
  });

  if (!row) return pendingMetric();
  return {
    value: row.value,
    source: `${args.sourcePrefix ?? "Facts"}:${args.factType}.${args.factKey}`,
    updated_at: row.created_at,
  };
}

function tryFindRowNumber(spread: RenderedSpread, opts: { key?: string; labelIncludes?: string[] }) {
  const key = opts.key ? norm(opts.key) : null;
  const includes = (opts.labelIncludes ?? []).map(norm);

  for (const r of spread.rows ?? []) {
    if (key && norm(r.key) === key) {
      const n = Array.isArray(r.values)
        ? (cellToNumber(r.values[0]) ?? (r.values.map(cellToNumber).find((x) => typeof x === "number") as number | undefined))
        : undefined;
      if (typeof n === "number" && Number.isFinite(n)) return n;
    }

    const label = norm(r.label ?? "");
    if (includes.length && includes.every((inc) => label.includes(inc))) {
      const n = Array.isArray(r.values)
        ? (r.values.map(cellToNumber).find((x) => typeof x === "number") as number | undefined)
        : undefined;
      if (typeof n === "number" && Number.isFinite(n)) return n;
    }
  }

  return null;
}

export async function getLatestSpread(args: {
  dealId: string;
  bankId: string;
  spreadType: SpreadType;
}): Promise<SpreadSnapshot | null> {
  const sb = supabaseAdmin();
  const res = await (sb as any)
    .from("deal_spreads")
    .select("spread_type,status,updated_at,rendered_json")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .eq("spread_type", args.spreadType)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error || !res.data) return null;

  return {
    spread_type: String(res.data.spread_type),
    status: String(res.data.status ?? "unknown"),
    updated_at: res.data.updated_at ?? null,
    rendered_json:
      res.data.rendered_json && typeof res.data.rendered_json === "object"
        ? (res.data.rendered_json as any)
        : null,
  };
}

export async function getLatestFactNum(args: {
  dealId: string;
  bankId: string;
  factType: string;
  factKey: string;
}): Promise<{ value: number | null; created_at: string | null } | null> {
  const sb = supabaseAdmin();
  const res = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_value_num, created_at")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .eq("fact_type", args.factType)
    .eq("fact_key", args.factKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error || !res.data) return null;

  const v = res.data.fact_value_num;
  return {
    value: typeof v === "number" ? v : v ? Number(v) : null,
    created_at: res.data.created_at ?? null,
  };
}

export async function computeDscrFromSpreads(args: {
  dealId: string;
  bankId: string;
}): Promise<MetricValue> {
  // Prefer GLOBAL_CASH_FLOW once implemented; fallback to T12 if needed.
  const gcf = await getLatestSpread({ dealId: args.dealId, bankId: args.bankId, spreadType: "GLOBAL_CASH_FLOW" });
  if (gcf?.rendered_json) {
    const v =
      tryFindRowNumber(gcf.rendered_json, { key: "DSCR" }) ??
      tryFindRowNumber(gcf.rendered_json, { key: "dscr" }) ??
      tryFindRowNumber(gcf.rendered_json, { labelIncludes: ["dscr"] });

    if (v !== null) {
      return { value: v, source: "Spreads:GLOBAL_CASH_FLOW", updated_at: gcf.updated_at };
    }

    // Even if value missing, prefer this source for provenance.
    return { value: null, source: "Spreads:GLOBAL_CASH_FLOW", updated_at: gcf.updated_at };
  }

  const t12 = await getLatestSpread({ dealId: args.dealId, bankId: args.bankId, spreadType: "T12" });
  if (t12?.rendered_json) {
    const v =
      tryFindRowNumber(t12.rendered_json, { key: "DSCR" }) ??
      tryFindRowNumber(t12.rendered_json, { key: "dscr" }) ??
      tryFindRowNumber(t12.rendered_json, { labelIncludes: ["dscr"] });

    return { value: v, source: "Spreads:T12", updated_at: t12.updated_at };
  }

  return { value: null, source: "Pending", updated_at: null };
}

export async function computeDscrGlobal(args: { dealId: string; bankId: string }): Promise<MetricValue> {
  const fromSpreads = await computeDscrFromSpreads(args);
  if (fromSpreads.value !== null) return fromSpreads;

  const fromFacts = await metricFromFactNum({
    dealId: args.dealId,
    bankId: args.bankId,
    factType: FACT.FINANCIAL_ANALYSIS.type,
    factKey: FACT.FINANCIAL_ANALYSIS.keys.DSCR,
  });
  return fromFacts.value !== null ? fromFacts : fromSpreads;
}

export async function computeDscrStressedFromSpreads(args: {
  dealId: string;
  bankId: string;
}): Promise<MetricValue> {
  const gcf = await getLatestSpread({ dealId: args.dealId, bankId: args.bankId, spreadType: "GLOBAL_CASH_FLOW" });
  if (gcf?.rendered_json) {
    const v =
      tryFindRowNumber(gcf.rendered_json, { key: "DSCR_STRESSED_300BPS" }) ??
      tryFindRowNumber(gcf.rendered_json, { key: "dscr_stressed" }) ??
      tryFindRowNumber(gcf.rendered_json, { labelIncludes: ["dscr", "stressed"] });

    return { value: v, source: "Spreads:GLOBAL_CASH_FLOW", updated_at: gcf.updated_at };
  }

  return { value: null, source: "Pending", updated_at: null };
}

export async function computeFinancialAnalysisMetrics(args: {
  dealId: string;
  bankId: string;
}): Promise<{
  cashFlowAvailable: MetricValue;
  annualDebtService: MetricValue;
  annualDebtServiceStressed300bps: MetricValue;
  excessCashFlow: MetricValue;
  dscrGlobal: MetricValue;
  dscrStressed300bps: MetricValue;
}> {
  const [
    cashFlowAvailable,
    annualDebtService,
    annualDebtServiceStressed300bps,
    dscrGlobal,
    dscrStressedFromSpreads,
    dscrStressedFromFacts,
  ] = await Promise.all([
    metricFromFactNum({
      dealId: args.dealId,
      bankId: args.bankId,
      factType: FACT.FINANCIAL_ANALYSIS.type,
      factKey: FACT.FINANCIAL_ANALYSIS.keys.CASH_FLOW_AVAILABLE,
    }),
    metricFromFactNum({
      dealId: args.dealId,
      bankId: args.bankId,
      factType: FACT.FINANCIAL_ANALYSIS.type,
      factKey: FACT.FINANCIAL_ANALYSIS.keys.ANNUAL_DEBT_SERVICE,
    }),
    metricFromFactNum({
      dealId: args.dealId,
      bankId: args.bankId,
      factType: FACT.FINANCIAL_ANALYSIS.type,
      factKey: FACT.FINANCIAL_ANALYSIS.keys.ANNUAL_DEBT_SERVICE_STRESSED_300BPS,
    }),
    computeDscrGlobal({ dealId: args.dealId, bankId: args.bankId }),
    computeDscrStressedFromSpreads({ dealId: args.dealId, bankId: args.bankId }),
    metricFromFactNum({
      dealId: args.dealId,
      bankId: args.bankId,
      factType: FACT.FINANCIAL_ANALYSIS.type,
      factKey: FACT.FINANCIAL_ANALYSIS.keys.DSCR_STRESSED_300BPS,
    }),
  ]);

  const excessCashFlow: MetricValue = (() => {
    if (cashFlowAvailable.value === null || annualDebtService.value === null) return pendingMetric();
    return {
      value: cashFlowAvailable.value - annualDebtService.value,
      source: "Computed:FINANCIAL_ANALYSIS.CASH_FLOW_AVAILABLE - FINANCIAL_ANALYSIS.ANNUAL_DEBT_SERVICE",
      updated_at: maxIsoTimestamps(cashFlowAvailable.updated_at, annualDebtService.updated_at),
    };
  })();

  const dscrStressed300bps: MetricValue = (() => {
    if (dscrStressedFromSpreads.value !== null) return dscrStressedFromSpreads;

    if (dscrStressedFromFacts.value !== null) return dscrStressedFromFacts;

    // Prefer explicit stressed DSCR fact if present.
    // Otherwise compute from cash flow + stressed debt service if available.
    // This keeps business logic deterministic and provenance explicit.
    // NOTE: Without a stressed debt service input, we intentionally stay Pending.
    //
    // (cash flow / debt service stressed)
    if (cashFlowAvailable.value !== null && annualDebtServiceStressed300bps.value !== null && annualDebtServiceStressed300bps.value !== 0) {
      return {
        value: cashFlowAvailable.value / annualDebtServiceStressed300bps.value,
        source: "Computed:CASH_FLOW_AVAILABLE / ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
        updated_at: maxIsoTimestamps(cashFlowAvailable.updated_at, annualDebtServiceStressed300bps.updated_at),
      };
    }

    return pendingMetric();
  })();

  return {
    cashFlowAvailable,
    annualDebtService,
    annualDebtServiceStressed300bps,
    excessCashFlow,
    dscrGlobal,
    dscrStressed300bps,
  };
}

export async function computeSourcesUsesMetrics(args: {
  dealId: string;
  bankId: string;
}): Promise<{
  totalProjectCost: MetricValue;
  borrowerEquity: MetricValue;
  borrowerEquityPct: MetricValue;
  bankLoanTotal: MetricValue;
}> {
  const [totalProjectCost, borrowerEquity, bankLoanTotal] = await Promise.all([
    metricFromFactNum({
      dealId: args.dealId,
      bankId: args.bankId,
      factType: FACT.SOURCES_USES.type,
      factKey: FACT.SOURCES_USES.keys.TOTAL_PROJECT_COST,
    }),
    metricFromFactNum({
      dealId: args.dealId,
      bankId: args.bankId,
      factType: FACT.SOURCES_USES.type,
      factKey: FACT.SOURCES_USES.keys.BORROWER_EQUITY,
    }),
    metricFromFactNum({
      dealId: args.dealId,
      bankId: args.bankId,
      factType: FACT.SOURCES_USES.type,
      factKey: FACT.SOURCES_USES.keys.BANK_LOAN_TOTAL,
    }),
  ]);

  const borrowerEquityPct: MetricValue = (() => {
    if (borrowerEquity.value === null || totalProjectCost.value === null || totalProjectCost.value === 0) return pendingMetric();
    return {
      value: (borrowerEquity.value / totalProjectCost.value) * 100,
      source: "Computed:BORROWER_EQUITY / TOTAL_PROJECT_COST",
      updated_at: maxIsoTimestamps(borrowerEquity.updated_at, totalProjectCost.updated_at),
    };
  })();

  return { totalProjectCost, borrowerEquity, borrowerEquityPct, bankLoanTotal };
}

export async function computeCollateralValues(args: {
  dealId: string;
  bankId: string;
}): Promise<{
  asIsValue: MetricValue;
  stabilizedValue: MetricValue;
  grossValue: MetricValue;
  netValue: MetricValue;
  discountedValue: MetricValue;
}> {
  const [asIs, stabilized, gross, net, discounted] = await Promise.all([
    getLatestFactNum({ dealId: args.dealId, bankId: args.bankId, factType: FACT.COLLATERAL.type, factKey: FACT.COLLATERAL.keys.AS_IS_VALUE }),
    getLatestFactNum({ dealId: args.dealId, bankId: args.bankId, factType: FACT.COLLATERAL.type, factKey: FACT.COLLATERAL.keys.STABILIZED_VALUE }),
    getLatestFactNum({ dealId: args.dealId, bankId: args.bankId, factType: FACT.COLLATERAL.type, factKey: FACT.COLLATERAL.keys.GROSS_VALUE }),
    getLatestFactNum({ dealId: args.dealId, bankId: args.bankId, factType: FACT.COLLATERAL.type, factKey: FACT.COLLATERAL.keys.NET_VALUE }),
    getLatestFactNum({ dealId: args.dealId, bankId: args.bankId, factType: FACT.COLLATERAL.type, factKey: FACT.COLLATERAL.keys.DISCOUNTED_VALUE }),
  ]);

  const asIsMetric: MetricValue = asIs
    ? { value: asIs.value, source: `Facts:${FACT.COLLATERAL.type}.${FACT.COLLATERAL.keys.AS_IS_VALUE}`, updated_at: asIs.created_at }
    : pendingMetric();

  const stabilizedMetric: MetricValue = stabilized
    ? { value: stabilized.value, source: `Facts:${FACT.COLLATERAL.type}.${FACT.COLLATERAL.keys.STABILIZED_VALUE}`, updated_at: stabilized.created_at }
    : pendingMetric();

  // Prefer explicit gross value, but allow AS_IS_VALUE as a fallback so existing fact pipelines still show something.
  const grossMetric: MetricValue = gross
    ? { value: gross.value, source: `Facts:${FACT.COLLATERAL.type}.${FACT.COLLATERAL.keys.GROSS_VALUE}`, updated_at: gross.created_at }
    : asIsMetric.value !== null
      ? { value: asIsMetric.value, source: `Facts:${FACT.COLLATERAL.type}.${FACT.COLLATERAL.keys.AS_IS_VALUE}`, updated_at: asIsMetric.updated_at }
      : pendingMetric();

  const netMetric: MetricValue = net
    ? { value: net.value, source: `Facts:${FACT.COLLATERAL.type}.${FACT.COLLATERAL.keys.NET_VALUE}`, updated_at: net.created_at }
    : pendingMetric();

  const discountedMetric: MetricValue = discounted
    ? { value: discounted.value, source: `Facts:${FACT.COLLATERAL.type}.${FACT.COLLATERAL.keys.DISCOUNTED_VALUE}`, updated_at: discounted.created_at }
    : pendingMetric();

  return {
    asIsValue: asIsMetric,
    stabilizedValue: stabilizedMetric,
    grossValue: grossMetric,
    netValue: netMetric,
    discountedValue: discountedMetric,
  };
}

export function computeDiscountedCoverageRatio(args: {
  discountedCollateralValue: MetricValue;
  bankLoanTotal: MetricValue;
}): MetricValue {
  const dv = args.discountedCollateralValue.value;
  const loan = args.bankLoanTotal.value;
  if (dv === null || loan === null || loan === 0) {
    if (args.discountedCollateralValue.source !== "Pending") {
      return { value: null, source: args.discountedCollateralValue.source, updated_at: args.discountedCollateralValue.updated_at };
    }
    return pendingMetric();
  }

  return {
    value: dv / loan,
    source: "Computed:DISCOUNTED_VALUE / BANK_LOAN_TOTAL",
    updated_at: maxIsoTimestamps(args.discountedCollateralValue.updated_at, args.bankLoanTotal.updated_at),
  };
}

export function computeLtvPct(args: {
  loanAmount: number | null;
  collateralValue: MetricValue;
  label: string;
}): MetricValue {
  if (args.loanAmount === null || args.collateralValue.value === null || args.collateralValue.value === 0) {
    return { value: null, source: args.collateralValue.source === "Pending" ? "Pending" : args.collateralValue.source, updated_at: args.collateralValue.updated_at };
  }

  const pct = (args.loanAmount / args.collateralValue.value) * 100;
  if (!Number.isFinite(pct)) {
    return { value: null, source: args.collateralValue.source, updated_at: args.collateralValue.updated_at };
  }

  return {
    value: pct,
    source: args.collateralValue.source,
    updated_at: args.collateralValue.updated_at,
  };
}

export function computeReadiness(args: {
  spreads: Array<{ spread_type: string; status: string; updated_at: string | null }>;
  requiredMetrics: RequiredMetric[];
}) {
  const spreadsByType = new Map(args.spreads.map((s) => [String(s.spread_type), s]));

  const missingSpreads: string[] = [];
  const erroredSpreads: string[] = [];
  for (const t of REQUIRED_SPREADS) {
    const s = spreadsByType.get(t);
    if (!s) missingSpreads.push(t);
    else if (String(s.status) === "error") erroredSpreads.push(t);
  }

  const missingMetrics: string[] = [];
  for (const rm of args.requiredMetrics) {
    if (rm.metric.value === null) missingMetrics.push(rm.label);
  }

  let status: "pending" | "partial" | "ready" | "error" = "pending";
  if (erroredSpreads.length) status = "error";
  else if (missingSpreads.length) status = "pending";
  else if (missingMetrics.length) status = "partial";
  else status = "ready";

  const lastUpdatedAt = args.spreads
    .map((s) => s.updated_at)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] ?? null;

  const lastMetricUpdatedAt = args.requiredMetrics
    .map((m) => m.metric.updated_at)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] ?? null;

  const last = maxIsoTimestamp(lastUpdatedAt, lastMetricUpdatedAt);

  return {
    status,
    last_generated_at: last,
    missing_spreads: missingSpreads,
    missing_metrics: missingMetrics,
  };
}
