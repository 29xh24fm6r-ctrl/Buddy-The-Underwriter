import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";

export type SnapshotSourceType = "MANUAL" | "SPREAD" | "DOC_EXTRACT" | "STRUCTURAL" | "UNKNOWN";

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
  | "gcf_dscr"
  // Income statement computed metrics
  | "revenue"
  | "cogs"
  | "gross_profit"
  | "ebitda"
  | "net_income"
  // Balance sheet computed metrics
  | "working_capital"
  | "current_ratio"
  | "debt_to_equity";

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

  // Income statement computed metrics
  revenue: SnapshotMetricValue;
  cogs: SnapshotMetricValue;
  gross_profit: SnapshotMetricValue;
  ebitda: SnapshotMetricValue;
  net_income: SnapshotMetricValue;

  // Balance sheet computed metrics
  working_capital: SnapshotMetricValue;
  current_ratio: SnapshotMetricValue;
  debt_to_equity: SnapshotMetricValue;

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
  if (raw === "STRUCTURAL") return "STRUCTURAL";
  if (raw === "DOC_EXTRACT") return "DOC_EXTRACT";
  return "UNKNOWN";
}

function sourcePriority(st: SnapshotSourceType): number {
  switch (st) {
    case "MANUAL":
      return 4;
    case "STRUCTURAL":
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

/**
 * Quick Look: operating company essentials only.
 * Quick look mode uses a smaller denominator for completeness_pct,
 * so a deal with just BTR + YTD financials can show meaningful progress.
 */
export const SNAPSHOT_REQUIRED_METRICS_QUICK_LOOK: SnapshotMetricName[] = [
  "total_income_ttm",
  "ebitda",
  "depreciation_addback",
  "noi_ttm",
  "cash_flow_available",
];

/**
 * C&I (Commercial & Industrial): income-focused metrics.
 */
export const SNAPSHOT_REQUIRED_METRICS_CI: SnapshotMetricName[] = [
  "revenue",
  "cogs",
  "gross_profit",
  "ebitda",
  "net_income",
  "cash_flow_available",
  "annual_debt_service",
  "dscr",
  "dscr_stressed_300bps",
  "total_assets",
  "total_liabilities",
  "net_worth",
];

/**
 * CRE (Commercial Real Estate): collateral + NOI focused metrics.
 */
export const SNAPSHOT_REQUIRED_METRICS_CRE: SnapshotMetricName[] = [
  "total_income_ttm",
  "noi_ttm",
  "opex_ttm",
  "cash_flow_available",
  "annual_debt_service",
  "dscr",
  "collateral_gross_value",
  "ltv_gross",
  "occupancy_pct",
  "in_place_rent_mo",
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
  dealMode?: string;
  dealType?: string | null;
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

  // ── Computed fallback: cash_flow_available from tax return components ──
  // If no direct CASH_FLOW_AVAILABLE fact exists, derive from
  // OBI (Ordinary Business Income) + Depreciation + Section 179 addbacks.
  if ((byMetric["cash_flow_available"]?.value_num ?? null) === null) {
    const obiFacts = args.facts.filter((f) => f.fact_key === "ORDINARY_BUSINESS_INCOME");
    const depFacts = args.facts.filter((f) => f.fact_key === "DEPRECIATION");
    const s179Facts = args.facts.filter((f) => f.fact_key === "SEC_179_EXPENSE");

    const bestObi = selectBestFact(obiFacts).chosen;
    const bestDep = selectBestFact(depFacts).chosen;
    const bestS179 = selectBestFact(s179Facts).chosen;

    if (bestObi?.fact_value_num != null) {
      const obiVal = bestObi.fact_value_num;
      const depVal = bestDep?.fact_value_num ?? 0;
      const s179Val = bestS179?.fact_value_num ?? 0;
      const computed = obiVal + depVal + s179Val;

      byMetric["cash_flow_available"] = {
        value_num: computed,
        value_text: null,
        as_of_date: factAsOfDate(bestObi),
        confidence: 0.75,
        source_type: "SPREAD",
        source_ref: "computed:obi+dep+s179",
        provenance: {
          source_type: "SPREAD",
          extractor: "snapshot:cash_flow_fallback:v1",
          components: { obi: obiVal, depreciation: depVal, s179: s179Val },
        },
      };

      sources.push({
        metric: "cash_flow_available",
        chosen: null,
        rejected: [],
        note: "computed_from_tax_return_components",
      });
    }
  }

  // ── Computed fallbacks: CI/SBA income statement + balance sheet ──
  // These fire when the primary MetricSpec lookup returns null.
  // Primary specs point to FINANCIAL_ANALYSIS namespace; BTR extractor writes
  // to TAX_RETURN namespace. These fallbacks bridge the gap without changing
  // any MetricSpec bindings (zero regression risk to spread-written facts).
  // Source priority: MANUAL > STRUCTURAL > SPREAD > DOC_EXTRACT.
  // Fallbacks use source_type = "SPREAD", source_ref = "computed:snapshot_fallback:v2".

  // F1 — revenue: GROSS_RECEIPTS (priority) → TOTAL_INCOME
  if ((byMetric["revenue"]?.value_num ?? null) === null) {
    const grossReceiptsFacts = args.facts.filter(
      (f) => f.fact_type === "TAX_RETURN" && f.fact_key === "GROSS_RECEIPTS",
    );
    const totalIncomeFacts = args.facts.filter(
      (f) => f.fact_type === "TAX_RETURN" && f.fact_key === "TOTAL_INCOME",
    );
    const best = selectBestFact(grossReceiptsFacts).chosen
      ?? selectBestFact(totalIncomeFacts).chosen;
    if (best?.fact_value_num != null) {
      byMetric["revenue"] = {
        value_num: best.fact_value_num,
        value_text: null,
        as_of_date: factAsOfDate(best),
        confidence: best.confidence ?? 0.8,
        source_type: "SPREAD",
        source_ref: "computed:snapshot_fallback:v2",
        provenance: {
          source_type: "SPREAD",
          source_ref: "computed:snapshot_fallback:v2",
          extractor: "snapshot:revenue_fallback:v1",
          fact_key_used: best.fact_key,
        },
      };
    }
  }

  // F2 — cogs: COST_OF_GOODS_SOLD from TAX_RETURN
  if ((byMetric["cogs"]?.value_num ?? null) === null) {
    const cogsFacts = args.facts.filter(
      (f) => f.fact_type === "TAX_RETURN" && f.fact_key === "COST_OF_GOODS_SOLD",
    );
    const best = selectBestFact(cogsFacts).chosen;
    if (best?.fact_value_num != null) {
      byMetric["cogs"] = {
        value_num: best.fact_value_num,
        value_text: null,
        as_of_date: factAsOfDate(best),
        confidence: best.confidence ?? 0.8,
        source_type: "SPREAD",
        source_ref: "computed:snapshot_fallback:v2",
        provenance: {
          source_type: "SPREAD",
          source_ref: "computed:snapshot_fallback:v2",
          extractor: "snapshot:cogs_fallback:v1",
        },
      };
    }
  }

  // F3 — gross_profit: revenue_resolved − cogs_resolved (computed)
  // Only fires after F1/F2 have had a chance to populate revenue and cogs.
  if ((byMetric["gross_profit"]?.value_num ?? null) === null) {
    const rev = byMetric["revenue"]?.value_num ?? null;
    const cogs = byMetric["cogs"]?.value_num ?? null;
    if (rev !== null && cogs !== null) {
      byMetric["gross_profit"] = {
        value_num: rev - cogs,
        value_text: null,
        as_of_date: byMetric["revenue"]?.as_of_date ?? null,
        confidence: 0.8,
        source_type: "SPREAD",
        source_ref: "computed:snapshot_fallback:v2",
        provenance: {
          source_type: "SPREAD",
          source_ref: "computed:snapshot_fallback:v2",
          extractor: "snapshot:gross_profit_fallback:v1",
          components: { revenue: rev, cogs },
        },
      };
    }
  }

  // F4 — net_income: ORDINARY_BUSINESS_INCOME (priority) → NET_INCOME from TAX_RETURN
  if ((byMetric["net_income"]?.value_num ?? null) === null) {
    const obiFacts = args.facts.filter(
      (f) => f.fact_type === "TAX_RETURN" && f.fact_key === "ORDINARY_BUSINESS_INCOME",
    );
    const netIncomeFacts = args.facts.filter(
      (f) => f.fact_type === "TAX_RETURN" && f.fact_key === "NET_INCOME",
    );
    const best = selectBestFact(obiFacts).chosen
      ?? selectBestFact(netIncomeFacts).chosen;
    if (best?.fact_value_num != null) {
      byMetric["net_income"] = {
        value_num: best.fact_value_num,
        value_text: null,
        as_of_date: factAsOfDate(best),
        confidence: best.confidence ?? 0.8,
        source_type: "SPREAD",
        source_ref: "computed:snapshot_fallback:v2",
        provenance: {
          source_type: "SPREAD",
          source_ref: "computed:snapshot_fallback:v2",
          extractor: "snapshot:net_income_fallback:v1",
          fact_key_used: best.fact_key,
        },
      };
    }
  }

  // F5 — ebitda: net_income_resolved + DEPRECIATION + INTEREST_EXPENSE from TAX_RETURN
  // Requires F4 to have fired first. Uses addback methodology.
  if ((byMetric["ebitda"]?.value_num ?? null) === null) {
    const netIncome = byMetric["net_income"]?.value_num ?? null;
    if (netIncome !== null) {
      const depFacts = args.facts.filter(
        (f) => f.fact_type === "TAX_RETURN" && f.fact_key === "DEPRECIATION",
      );
      const intFacts = args.facts.filter(
        (f) => f.fact_type === "TAX_RETURN" && f.fact_key === "INTEREST_EXPENSE",
      );
      const bestDep = selectBestFact(depFacts).chosen;
      const bestInt = selectBestFact(intFacts).chosen;
      const dep = bestDep?.fact_value_num ?? 0;
      const interest = bestInt?.fact_value_num ?? 0;
      const computed = netIncome + dep + interest;
      byMetric["ebitda"] = {
        value_num: computed,
        value_text: null,
        as_of_date: byMetric["net_income"]?.as_of_date ?? null,
        confidence: 0.75,
        source_type: "SPREAD",
        source_ref: "computed:snapshot_fallback:v2",
        provenance: {
          source_type: "SPREAD",
          source_ref: "computed:snapshot_fallback:v2",
          extractor: "snapshot:ebitda_fallback:v1",
          components: { net_income: netIncome, depreciation: dep, interest_expense: interest },
        },
      };
    }
  }

  // F6 — total_assets: SL_TOTAL_ASSETS from TAX_RETURN (BTR Schedule L)
  // Fires only when no BALANCE_SHEET/TOTAL_ASSETS fact exists.
  if ((byMetric["total_assets"]?.value_num ?? null) === null) {
    const slAssetsFacts = args.facts.filter(
      (f) => f.fact_type === "TAX_RETURN" && f.fact_key === "SL_TOTAL_ASSETS",
    );
    const best = selectBestFact(slAssetsFacts).chosen;
    if (best?.fact_value_num != null) {
      byMetric["total_assets"] = {
        value_num: best.fact_value_num,
        value_text: null,
        as_of_date: factAsOfDate(best),
        confidence: best.confidence ?? 0.8,
        source_type: "SPREAD",
        source_ref: "computed:snapshot_fallback:v2",
        provenance: {
          source_type: "SPREAD",
          source_ref: "computed:snapshot_fallback:v2",
          extractor: "snapshot:total_assets_fallback:v1",
          fact_key_used: "SL_TOTAL_ASSETS",
        },
      };
    }
  }

  // F7 — total_liabilities: SL_TOTAL_LIABILITIES from TAX_RETURN (BTR Schedule L)
  // Fires only when no BALANCE_SHEET/TOTAL_LIABILITIES fact exists.
  if ((byMetric["total_liabilities"]?.value_num ?? null) === null) {
    const slLiabFacts = args.facts.filter(
      (f) => f.fact_type === "TAX_RETURN" && f.fact_key === "SL_TOTAL_LIABILITIES",
    );
    const best = selectBestFact(slLiabFacts).chosen;
    if (best?.fact_value_num != null) {
      byMetric["total_liabilities"] = {
        value_num: best.fact_value_num,
        value_text: null,
        as_of_date: factAsOfDate(best),
        confidence: best.confidence ?? 0.8,
        source_type: "SPREAD",
        source_ref: "computed:snapshot_fallback:v2",
        provenance: {
          source_type: "SPREAD",
          source_ref: "computed:snapshot_fallback:v2",
          extractor: "snapshot:total_liabilities_fallback:v1",
          fact_key_used: "SL_TOTAL_LIABILITIES",
        },
      };
    }
  }

  // F8 — net_worth: SL_TOTAL_EQUITY (TAX_RETURN) → compute (total_assets − total_liabilities)
  // Three-tier resolution:
  //   Tier 1: SL_TOTAL_EQUITY from TAX_RETURN (explicit equity from Schedule L)
  //   Tier 2: total_assets_resolved − total_liabilities_resolved (after F6/F7)
  //   Fires only when no BALANCE_SHEET/NET_WORTH fact exists.
  if ((byMetric["net_worth"]?.value_num ?? null) === null) {
    // Tier 1: SL_TOTAL_EQUITY
    const slEquityFacts = args.facts.filter(
      (f) => f.fact_type === "TAX_RETURN" && f.fact_key === "SL_TOTAL_EQUITY",
    );
    const bestEquity = selectBestFact(slEquityFacts).chosen;
    if (bestEquity?.fact_value_num != null) {
      byMetric["net_worth"] = {
        value_num: bestEquity.fact_value_num,
        value_text: null,
        as_of_date: factAsOfDate(bestEquity),
        confidence: bestEquity.confidence ?? 0.8,
        source_type: "SPREAD",
        source_ref: "computed:snapshot_fallback:v2",
        provenance: {
          source_type: "SPREAD",
          source_ref: "computed:snapshot_fallback:v2",
          extractor: "snapshot:net_worth_fallback:v1",
          fact_key_used: "SL_TOTAL_EQUITY",
        },
      };
    } else {
      // Tier 2: derived from resolved total_assets and total_liabilities
      const assets = byMetric["total_assets"]?.value_num ?? null;
      const liabs = byMetric["total_liabilities"]?.value_num ?? null;
      if (assets !== null && liabs !== null) {
        byMetric["net_worth"] = {
          value_num: assets - liabs,
          value_text: null,
          as_of_date: byMetric["total_assets"]?.as_of_date ?? null,
          confidence: 0.75,
          source_type: "SPREAD",
          source_ref: "computed:snapshot_fallback:v2",
          provenance: {
            source_type: "SPREAD",
            source_ref: "computed:snapshot_fallback:v2",
            extractor: "snapshot:net_worth_fallback:v1",
            components: { total_assets: assets, total_liabilities: liabs },
          },
        };
      }
    }
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

  // Select required metrics based on deal mode and deal type
  // Normalize dealType to lowercase+underscore for case-insensitive matching
  // (DB stores values like "SBA", "SBA_7A", "c_and_i", "cre_investor" — normalize all)
  const dealTypeNorm = args.dealType
    ? args.dealType.toLowerCase().replace(/[^a-z0-9]/g, "_")
    : null;

  let requiredMetrics: SnapshotMetricName[];
  if (args.dealMode === "quick_look") {
    requiredMetrics = SNAPSHOT_REQUIRED_METRICS_QUICK_LOOK;
  } else if (
    dealTypeNorm === "c_and_i" ||
    dealTypeNorm === "sba" ||
    dealTypeNorm === "sba_7a" ||
    dealTypeNorm === "sba_504"
  ) {
    requiredMetrics = SNAPSHOT_REQUIRED_METRICS_CI;
  } else if (
    dealTypeNorm === "cre_investor" ||
    dealTypeNorm === "cre_owner_occupied" ||
    dealTypeNorm === "cre"
  ) {
    requiredMetrics = SNAPSHOT_REQUIRED_METRICS_CRE;
  } else {
    requiredMetrics = SNAPSHOT_REQUIRED_METRICS_V1;
  }

  // Snapshot-level as_of_date: only set if all present required metrics share the same as_of_date.
  const presentAsOf = requiredMetrics.map((m) => (byMetric[m]?.as_of_date ?? null)).filter(Boolean) as string[];
  const unique = Array.from(new Set(presentAsOf));
  const snapshotAsOf = unique.length === 1 ? unique[0]! : null;
  if (unique.length > 1) {
    sources.push({ metric: "cash_flow_available", chosen: null, rejected: [], note: "mixed_as_of_dates" });
  }

  const missingRequired = requiredMetrics.filter((m) => {
    const v = byMetric[m];
    return !v || (v.value_num === null && v.value_text === null);
  });

  const completeCount = requiredMetrics.length - missingRequired.length;
  const completenessPct = requiredMetrics.length
    ? Math.round((completeCount / requiredMetrics.length) * 1000) / 10
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

    revenue: get("revenue"),
    cogs: get("cogs"),
    gross_profit: get("gross_profit"),
    ebitda: get("ebitda"),
    net_income: get("net_income"),

    working_capital: get("working_capital"),
    current_ratio: get("current_ratio"),
    debt_to_equity: get("debt_to_equity"),

    as_of_date: snapshotAsOf,
    completeness_pct: completenessPct,
    missing_required_keys: missingRequired,
    sources_summary: sources,
  };
}
