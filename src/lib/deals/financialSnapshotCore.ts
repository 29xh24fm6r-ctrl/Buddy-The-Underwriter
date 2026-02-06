import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";

export type SnapshotSourceType = "MANUAL" | "SPREAD" | "DOC_EXTRACT" | "UNKNOWN";

export type SnapshotMetricName =
  | "total_income_ttm"
  | "noi_ttm"
  | "opex_ttm"
  | "cash_flow_available"
  | "annual_debt_service"
  | "excess_cash_flow"
  | "dscr"
  | "dscr_stressed_300bps"
  | "collateral_gross_value"
  | "collateral_net_value"
  | "collateral_discounted_value"
  | "collateral_coverage"
  | "ltv_gross"
  | "ltv_net"
  | "in_place_rent_mo"
  | "occupancy_pct"
  | "vacancy_pct"
  | "walt_years"
  | "total_project_cost"
  | "borrower_equity"
  | "borrower_equity_pct"
  | "bank_loan_total"
  // Balance sheet
  | "total_assets"
  | "total_liabilities"
  | "net_worth"
  // Tax return / global cash flow
  | "gross_receipts"
  | "depreciation_addback"
  | "global_cash_flow"
  // Personal income / PFS / GCF
  | "personal_total_income"
  | "pfs_total_assets"
  | "pfs_total_liabilities"
  | "pfs_net_worth"
  | "gcf_global_cash_flow"
  | "gcf_dscr";

export type SnapshotMetricValue = {
  value_num: number | null;
  value_text: string | null;
  as_of_date: string | null;
  confidence: number | null;
  source_type: SnapshotSourceType;
  source_ref: string | null;
  provenance: FinancialFactProvenance | any | null;
};

export type SnapshotSourceDetail = {
  fact_id: string;
  fact_type: string;
  fact_key: string;
  created_at: string;
  value_num: number | null;
  value_text: string | null;
  as_of_date: string | null;
  confidence: number | null;
  source_type: SnapshotSourceType;
  source_ref: string | null;
};

export type SnapshotSourceSummary = {
  metric: SnapshotMetricName;
  chosen: SnapshotSourceDetail | null;
  rejected: SnapshotSourceDetail[];
  note?: string;
};

export type DealFinancialSnapshotV1 = {
  version: 1;

  // Required locked v1 fields
  total_income_ttm: SnapshotMetricValue;
  noi_ttm: SnapshotMetricValue;
  opex_ttm: SnapshotMetricValue;
  cash_flow_available: SnapshotMetricValue;
  annual_debt_service: SnapshotMetricValue;
  excess_cash_flow: SnapshotMetricValue;
  dscr: SnapshotMetricValue;
  dscr_stressed_300bps: SnapshotMetricValue;

  collateral_gross_value: SnapshotMetricValue;
  collateral_net_value: SnapshotMetricValue;
  collateral_discounted_value: SnapshotMetricValue;
  collateral_coverage: SnapshotMetricValue;
  ltv_gross: SnapshotMetricValue;
  ltv_net: SnapshotMetricValue;

  in_place_rent_mo: SnapshotMetricValue;
  occupancy_pct: SnapshotMetricValue;
  vacancy_pct: SnapshotMetricValue;
  walt_years: SnapshotMetricValue;

  total_project_cost: SnapshotMetricValue;
  borrower_equity: SnapshotMetricValue;
  borrower_equity_pct: SnapshotMetricValue;
  bank_loan_total: SnapshotMetricValue;

  // Balance sheet
  total_assets: SnapshotMetricValue;
  total_liabilities: SnapshotMetricValue;
  net_worth: SnapshotMetricValue;

  // Tax return / global cash flow
  gross_receipts: SnapshotMetricValue;
  depreciation_addback: SnapshotMetricValue;
  global_cash_flow: SnapshotMetricValue;

  // Personal income / PFS / GCF
  personal_total_income: SnapshotMetricValue;
  pfs_total_assets: SnapshotMetricValue;
  pfs_total_liabilities: SnapshotMetricValue;
  pfs_net_worth: SnapshotMetricValue;
  gcf_global_cash_flow: SnapshotMetricValue;
  gcf_dscr: SnapshotMetricValue;

  // Meta
  as_of_date: string | null;
  completeness_pct: number;
  missing_required_keys: SnapshotMetricName[];
  sources_summary: SnapshotSourceSummary[];
};

export type MinimalFact = {
  id: string;
  fact_type: string;
  fact_key: string;
  fact_period_start: string | null;
  fact_period_end: string | null;
  fact_value_num: number | null;
  fact_value_text: string | null;
  confidence: number | null;
  provenance: any;
  created_at: string;
};

function toIsoDatePrefix(s: unknown): string | null {
  if (!s) return null;
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return null;
}

export function factAsOfDate(f: MinimalFact): string | null {
  const provAsOf = toIsoDatePrefix(f.provenance?.as_of_date);
  if (provAsOf) return provAsOf;

  const pe = toIsoDatePrefix(f.fact_period_end);
  if (pe) return pe;

  const ps = toIsoDatePrefix(f.fact_period_start);
  if (ps) return ps;

  const created = toIsoDatePrefix(f.created_at);
  if (created) return created;

  return null;
}

export function factSourceType(f: MinimalFact): SnapshotSourceType {
  const raw = String(f.provenance?.source_type ?? "").toUpperCase();
  if (raw === "MANUAL") return "MANUAL";
  if (raw === "SPREAD") return "SPREAD";
  if (raw === "DOC_EXTRACT") return "DOC_EXTRACT";
  return "UNKNOWN";
}

function sourcePriority(st: SnapshotSourceType): number {
  switch (st) {
    case "MANUAL":
      return 3;
    case "SPREAD":
      return 2;
    case "DOC_EXTRACT":
      return 1;
    default:
      return 0;
  }
}

function toSourceDetail(f: MinimalFact): SnapshotSourceDetail {
  return {
    fact_id: f.id,
    fact_type: f.fact_type,
    fact_key: f.fact_key,
    created_at: f.created_at,
    value_num: f.fact_value_num ?? null,
    value_text: f.fact_value_text ?? null,
    as_of_date: factAsOfDate(f),
    confidence: typeof f.confidence === "number" ? f.confidence : null,
    source_type: factSourceType(f),
    source_ref: typeof f.provenance?.source_ref === "string" ? f.provenance.source_ref : null,
  };
}

export function selectBestFact(facts: MinimalFact[]): { chosen: MinimalFact | null; rejected: MinimalFact[] } {
  const sorted = facts
    .slice()
    .sort((a, b) => {
      const pa = sourcePriority(factSourceType(a));
      const pb = sourcePriority(factSourceType(b));
      if (pa !== pb) return pb - pa;

      const da = factAsOfDate(a);
      const db = factAsOfDate(b);
      if (da !== db) return (db ?? "") < (da ?? "") ? -1 : (db ?? "") > (da ?? "") ? 1 : 0;

      const ca = typeof a.confidence === "number" ? a.confidence : -1;
      const cb = typeof b.confidence === "number" ? b.confidence : -1;
      if (ca !== cb) return cb - ca;

      const ta = a.created_at ?? "";
      const tb = b.created_at ?? "";
      if (ta !== tb) return tb < ta ? -1 : tb > ta ? 1 : 0;

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const chosen = sorted[0] ?? null;
  const rejected = chosen ? sorted.slice(1) : [];
  return { chosen, rejected };
}

export type MetricSpec = {
  metric: SnapshotMetricName;
  fact_type: string;
  fact_key: string;
};

export const SNAPSHOT_REQUIRED_METRICS_V1: SnapshotMetricName[] = [
  "total_income_ttm",
  "noi_ttm",
  "opex_ttm",
  "cash_flow_available",
  "annual_debt_service",
  "excess_cash_flow",
  "dscr",
  "dscr_stressed_300bps",
  "collateral_gross_value",
  "collateral_net_value",
  "collateral_discounted_value",
  "collateral_coverage",
  "ltv_gross",
  "ltv_net",
  "in_place_rent_mo",
  "occupancy_pct",
  "vacancy_pct",
  "total_project_cost",
  "borrower_equity",
  "borrower_equity_pct",
  "bank_loan_total",
];

export function buildEmptyMetric(): SnapshotMetricValue {
  return {
    value_num: null,
    value_text: null,
    as_of_date: null,
    confidence: null,
    source_type: "UNKNOWN",
    source_ref: null,
    provenance: null,
  };
}

export function buildSnapshotFromFacts(args: {
  facts: MinimalFact[];
  metricSpecs: MetricSpec[];
  waltYears?: SnapshotMetricValue;
}): DealFinancialSnapshotV1 {
  const byMetric: Partial<Record<SnapshotMetricName, SnapshotMetricValue>> = {};
  const sources: SnapshotSourceSummary[] = [];

  for (const spec of args.metricSpecs) {
    const candidates = args.facts.filter((f) => f.fact_type === spec.fact_type && f.fact_key === spec.fact_key);
    const { chosen, rejected } = selectBestFact(candidates);

    const chosenDetail = chosen ? toSourceDetail(chosen) : null;
    const rejectedDetails = rejected.map(toSourceDetail);

    sources.push({
      metric: spec.metric,
      chosen: chosenDetail,
      rejected: rejectedDetails,
      note: rejectedDetails.length ? "conflict_resolved" : undefined,
    });

    byMetric[spec.metric] = {
      value_num: chosen?.fact_value_num ?? null,
      value_text: chosen?.fact_value_text ?? null,
      as_of_date: chosen ? factAsOfDate(chosen) : null,
      confidence: chosen && typeof chosen.confidence === "number" ? chosen.confidence : null,
      source_type: chosen ? factSourceType(chosen) : "UNKNOWN",
      source_ref: chosen && typeof chosen.provenance?.source_ref === "string" ? chosen.provenance.source_ref : null,
      provenance: chosen ? chosen.provenance ?? null : null,
    };
  }

  // Optional computed metric: walt_years (not required)
  const walt = args.waltYears ?? buildEmptyMetric();
  sources.push({
    metric: "walt_years",
    chosen:
      walt.value_num === null
        ? null
        : {
            fact_id: "computed:walt_years",
            fact_type: "RENT_ROLL",
            fact_key: "WALT_YEARS",
            created_at: new Date().toISOString(),
            value_num: walt.value_num,
            value_text: walt.value_text,
            as_of_date: walt.as_of_date,
            confidence: walt.confidence,
            source_type: walt.source_type,
            source_ref: walt.source_ref,
          },
    rejected: [],
  });

  // Snapshot-level as_of_date: only set if all present required metrics share the same as_of_date.
  const presentAsOf = SNAPSHOT_REQUIRED_METRICS_V1.map((m) => (byMetric[m]?.as_of_date ?? null)).filter(Boolean) as string[];
  const unique = Array.from(new Set(presentAsOf));
  const snapshotAsOf = unique.length === 1 ? unique[0]! : null;
  if (unique.length > 1) {
    sources.push({ metric: "cash_flow_available", chosen: null, rejected: [], note: "mixed_as_of_dates" });
  }

  const missingRequired = SNAPSHOT_REQUIRED_METRICS_V1.filter((m) => {
    const v = byMetric[m];
    return !v || (v.value_num === null && v.value_text === null);
  });

  const completeCount = SNAPSHOT_REQUIRED_METRICS_V1.length - missingRequired.length;
  const completenessPct = SNAPSHOT_REQUIRED_METRICS_V1.length
    ? Math.round((completeCount / SNAPSHOT_REQUIRED_METRICS_V1.length) * 1000) / 10
    : 0;

  const get = (m: SnapshotMetricName) => byMetric[m] ?? buildEmptyMetric();

  return {
    version: 1,

    total_income_ttm: get("total_income_ttm"),
    noi_ttm: get("noi_ttm"),
    opex_ttm: get("opex_ttm"),
    cash_flow_available: get("cash_flow_available"),
    annual_debt_service: get("annual_debt_service"),
    excess_cash_flow: get("excess_cash_flow"),
    dscr: get("dscr"),
    dscr_stressed_300bps: get("dscr_stressed_300bps"),

    collateral_gross_value: get("collateral_gross_value"),
    collateral_net_value: get("collateral_net_value"),
    collateral_discounted_value: get("collateral_discounted_value"),
    collateral_coverage: get("collateral_coverage"),
    ltv_gross: get("ltv_gross"),
    ltv_net: get("ltv_net"),

    in_place_rent_mo: get("in_place_rent_mo"),
    occupancy_pct: get("occupancy_pct"),
    vacancy_pct: get("vacancy_pct"),
    walt_years: walt,

    total_project_cost: get("total_project_cost"),
    borrower_equity: get("borrower_equity"),
    borrower_equity_pct: get("borrower_equity_pct"),
    bank_loan_total: get("bank_loan_total"),

    total_assets: get("total_assets"),
    total_liabilities: get("total_liabilities"),
    net_worth: get("net_worth"),

    gross_receipts: get("gross_receipts"),
    depreciation_addback: get("depreciation_addback"),
    global_cash_flow: get("global_cash_flow"),

    personal_total_income: get("personal_total_income"),
    pfs_total_assets: get("pfs_total_assets"),
    pfs_total_liabilities: get("pfs_total_liabilities"),
    pfs_net_worth: get("pfs_net_worth"),
    gcf_global_cash_flow: get("gcf_global_cash_flow"),
    gcf_dscr: get("gcf_dscr"),

    as_of_date: snapshotAsOf,
    completeness_pct: completenessPct,
    missing_required_keys: missingRequired,
    sources_summary: sources,
  };
}
