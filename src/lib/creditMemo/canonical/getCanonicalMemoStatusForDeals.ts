import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SpreadType } from "@/lib/financialSpreads/types";
import type { RenderedSpread } from "@/lib/financialSpreads/types";
import {
  computeDiscountedCoverageRatio,
  computeLtvPct,
  computeReadiness,
  type MetricValue,
  type RequiredMetric,
} from "@/lib/creditMemo/canonical/factsAdapter";

export type CanonicalMemoStatusRow = {
  deal_id: string;
  status: "pending" | "partial" | "ready" | "error";
  last_generated_at: string | null;
  missing_spreads: string[];
};

const REQUIRED_SPREADS: SpreadType[] = ["GLOBAL_CASH_FLOW"];

const REQUIRED_FACT_TYPES = ["COLLATERAL", "SOURCES_USES", "FINANCIAL_ANALYSIS"] as const;

const REQUIRED_FACT_KEYS = {
  COLLATERAL: ["AS_IS_VALUE", "GROSS_VALUE", "NET_VALUE", "DISCOUNTED_VALUE"],
  SOURCES_USES: ["TOTAL_PROJECT_COST", "BORROWER_EQUITY", "BANK_LOAN_TOTAL"],
  FINANCIAL_ANALYSIS: [
    "CASH_FLOW_AVAILABLE",
    "ANNUAL_DEBT_SERVICE",
    "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
    "DSCR",
    "DSCR_STRESSED_300BPS",
  ],
} as const;

function pendingMetric(): MetricValue {
  return { value: null, source: "Pending", updated_at: null };
}

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

export async function getCanonicalMemoStatusForDeals(args: {
  bankId: string;
  dealIds: string[];
}): Promise<Record<string, CanonicalMemoStatusRow>> {
  const sb = supabaseAdmin();
  if (!args.dealIds.length) return {};

  const [spreadsRes, factsRes] = await Promise.all([
    (sb as any)
    .from("deal_spreads")
    .select("deal_id, spread_type, status, updated_at, rendered_json")
    .eq("bank_id", args.bankId)
    .in("deal_id", args.dealIds)
    .in("spread_type", REQUIRED_SPREADS as any),
    (sb as any)
      .from("deal_financial_facts")
      .select("deal_id, fact_type, fact_key, fact_value_num, created_at")
      .eq("bank_id", args.bankId)
      .in("deal_id", args.dealIds)
      .in("fact_type", REQUIRED_FACT_TYPES as any)
      .in(
        "fact_key",
        Array.from(
          new Set(
            [
              ...REQUIRED_FACT_KEYS.COLLATERAL,
              ...REQUIRED_FACT_KEYS.SOURCES_USES,
              ...REQUIRED_FACT_KEYS.FINANCIAL_ANALYSIS,
            ].map(String),
          ),
        ) as any,
      ),
  ]);

  const spreadRows = spreadsRes.error ? [] : (spreadsRes.data ?? []);
  const factRows = factsRes.error ? [] : (factsRes.data ?? []);

  // Latest spread per (deal_id, spread_type)
  const spreadsByDealType = new Map<string, { status: string; updated_at: string | null; rendered_json: RenderedSpread | null }>();
  for (const r of spreadRows) {
    const k = `${String(r.deal_id)}::${String(r.spread_type)}`;
    const existing = spreadsByDealType.get(k);
    const nextUpdatedAt = r.updated_at ?? null;
    if (!existing || ((existing.updated_at ?? "") < (nextUpdatedAt ?? ""))) {
      spreadsByDealType.set(k, {
        status: String(r.status ?? "unknown"),
        updated_at: nextUpdatedAt,
        rendered_json:
          r.rendered_json && typeof r.rendered_json === "object" ? (r.rendered_json as any) : null,
      });
    }
  }

  // Latest fact per (deal_id, fact_type, fact_key)
  const factsByDealTypeKey = new Map<string, { value: number | null; created_at: string | null }>();
  for (const r of factRows) {
    const dealId = String(r.deal_id);
    const factType = String(r.fact_type);
    const factKey = String(r.fact_key);
    const k = `${dealId}::${factType}::${factKey}`;
    const existing = factsByDealTypeKey.get(k);
    const createdAt = r.created_at ?? null;
    if (!existing || ((existing.created_at ?? "") < (createdAt ?? ""))) {
      const raw = r.fact_value_num;
      const v = typeof raw === "number" ? raw : raw ? Number(raw) : null;
      factsByDealTypeKey.set(k, { value: Number.isFinite(v as any) ? (v as any) : null, created_at: createdAt });
    }
  }

  function factMetric(dealId: string, factType: string, factKey: string): MetricValue {
    const k = `${dealId}::${factType}::${factKey}`;
    const row = factsByDealTypeKey.get(k);
    if (!row) return pendingMetric();
    return {
      value: row.value,
      source: `Facts:${factType}.${factKey}`,
      updated_at: row.created_at,
    };
  }

  const out: Record<string, CanonicalMemoStatusRow> = {};

  for (const dealId of args.dealIds) {
    const spreads = REQUIRED_SPREADS.map((t) => {
      const row = spreadsByDealType.get(`${dealId}::${t}`);
      return row
        ? { spread_type: t, status: row.status, updated_at: row.updated_at }
        : null;
    }).filter(Boolean) as Array<{ spread_type: string; status: string; updated_at: string | null }>;

    const gcf = spreadsByDealType.get(`${dealId}::GLOBAL_CASH_FLOW`);
    const t12 = spreadsByDealType.get(`${dealId}::T12`);

    const dscrFromSpread: MetricValue = (() => {
      const snap = gcf?.rendered_json ?? t12?.rendered_json;
      const updatedAt = gcf?.updated_at ?? t12?.updated_at ?? null;
      const source = gcf?.rendered_json ? "Spreads:GLOBAL_CASH_FLOW" : t12?.rendered_json ? "Spreads:T12" : "Pending";
      if (!snap) return pendingMetric();
      const v =
        tryFindRowNumber(snap, { key: "DSCR" }) ??
        tryFindRowNumber(snap, { key: "dscr" }) ??
        tryFindRowNumber(snap, { labelIncludes: ["dscr"] });
      return { value: v, source, updated_at: updatedAt };
    })();

    const dscrFromFacts = factMetric(dealId, "FINANCIAL_ANALYSIS", "DSCR");
    const dscrGlobal: MetricValue = dscrFromSpread.value !== null ? dscrFromSpread : dscrFromFacts.value !== null ? dscrFromFacts : pendingMetric();

    const dscrStressedFromSpread: MetricValue = (() => {
      const snap = gcf?.rendered_json ?? null;
      if (!snap) return pendingMetric();
      const v =
        tryFindRowNumber(snap, { key: "DSCR_STRESSED_300BPS" }) ??
        tryFindRowNumber(snap, { key: "dscr_stressed_300bps" }) ??
        tryFindRowNumber(snap, { key: "dscr_stressed" }) ??
        tryFindRowNumber(snap, { labelIncludes: ["dscr", "stressed"] });
      return { value: v, source: "Spreads:GLOBAL_CASH_FLOW", updated_at: gcf?.updated_at ?? null };
    })();

    const dscrStressedFromFacts = factMetric(dealId, "FINANCIAL_ANALYSIS", "DSCR_STRESSED_300BPS");

    const cashFlowAvailable = factMetric(dealId, "FINANCIAL_ANALYSIS", "CASH_FLOW_AVAILABLE");
    const annualDebtService = factMetric(dealId, "FINANCIAL_ANALYSIS", "ANNUAL_DEBT_SERVICE");
    const annualDebtServiceStressed = factMetric(dealId, "FINANCIAL_ANALYSIS", "ANNUAL_DEBT_SERVICE_STRESSED_300BPS");

    const excessCashFlow: MetricValue = (() => {
      if (cashFlowAvailable.value === null || annualDebtService.value === null) return pendingMetric();
      return {
        value: cashFlowAvailable.value - annualDebtService.value,
        source: "Computed:CASH_FLOW_AVAILABLE - ANNUAL_DEBT_SERVICE",
        updated_at: [cashFlowAvailable.updated_at, annualDebtService.updated_at].filter(Boolean).sort().slice(-1)[0] ?? null,
      };
    })();

    const dscrStressed300bps: MetricValue = (() => {
      if (dscrStressedFromSpread.value !== null) return dscrStressedFromSpread;
      if (dscrStressedFromFacts.value !== null) return dscrStressedFromFacts;
      if (cashFlowAvailable.value !== null && annualDebtServiceStressed.value !== null && annualDebtServiceStressed.value !== 0) {
        return {
          value: cashFlowAvailable.value / annualDebtServiceStressed.value,
          source: "Computed:CASH_FLOW_AVAILABLE / ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
          updated_at: [cashFlowAvailable.updated_at, annualDebtServiceStressed.updated_at].filter(Boolean).sort().slice(-1)[0] ?? null,
        };
      }
      return pendingMetric();
    })();

    const totalProjectCost = factMetric(dealId, "SOURCES_USES", "TOTAL_PROJECT_COST");
    const borrowerEquity = factMetric(dealId, "SOURCES_USES", "BORROWER_EQUITY");
    const bankLoanTotal = factMetric(dealId, "SOURCES_USES", "BANK_LOAN_TOTAL");
    const borrowerEquityPct: MetricValue = (() => {
      if (borrowerEquity.value === null || totalProjectCost.value === null || totalProjectCost.value === 0) return pendingMetric();
      return {
        value: (borrowerEquity.value / totalProjectCost.value) * 100,
        source: "Computed:BORROWER_EQUITY / TOTAL_PROJECT_COST",
        updated_at: [borrowerEquity.updated_at, totalProjectCost.updated_at].filter(Boolean).sort().slice(-1)[0] ?? null,
      };
    })();

    const asIs = factMetric(dealId, "COLLATERAL", "AS_IS_VALUE");
    const gross = factMetric(dealId, "COLLATERAL", "GROSS_VALUE");
    const net = factMetric(dealId, "COLLATERAL", "NET_VALUE");
    const discounted = factMetric(dealId, "COLLATERAL", "DISCOUNTED_VALUE");

    const grossCollateral: MetricValue = gross.value !== null ? gross : asIs.value !== null ? asIs : pendingMetric();
    const netCollateral: MetricValue = net;
    const ltvGross = computeLtvPct({ loanAmount: bankLoanTotal.value, collateralValue: grossCollateral, label: "LTV Gross" });
    const ltvNet = computeLtvPct({ loanAmount: bankLoanTotal.value, collateralValue: netCollateral, label: "LTV Net" });
    const discountedCoverage = computeDiscountedCoverageRatio({ discountedCollateralValue: discounted, bankLoanTotal });

    const requiredMetrics: RequiredMetric[] = [
      { key: "DSCR_GLOBAL", label: "DSCR", metric: dscrGlobal },
      { key: "DSCR_STRESSED_300BPS", label: "Stressed DSCR (+300bps)", metric: dscrStressed300bps },
      { key: "CASH_FLOW_AVAILABLE", label: "Cash Flow Available", metric: cashFlowAvailable },
      { key: "ANNUAL_DEBT_SERVICE", label: "Annual Debt Service", metric: annualDebtService },
      { key: "EXCESS_CASH_FLOW", label: "Excess Cash Flow", metric: excessCashFlow },
      { key: "COLLATERAL_GROSS_VALUE", label: "Gross Collateral Value", metric: grossCollateral },
      { key: "COLLATERAL_NET_VALUE", label: "Net Collateral Value", metric: netCollateral },
      { key: "LTV_GROSS", label: "Gross LTV", metric: ltvGross },
      { key: "LTV_NET", label: "Net LTV", metric: ltvNet },
      { key: "DISCOUNTED_COVERAGE", label: "Discounted Coverage", metric: discountedCoverage },
      { key: "TOTAL_PROJECT_COST", label: "Total Project Cost", metric: totalProjectCost },
      { key: "BORROWER_EQUITY", label: "Borrower Equity", metric: borrowerEquity },
      { key: "BORROWER_EQUITY_PCT", label: "Borrower Equity %", metric: borrowerEquityPct },
      { key: "BANK_LOAN_TOTAL", label: "Bank Loan Total", metric: bankLoanTotal },
    ];

    const readiness = computeReadiness({ spreads, requiredMetrics });

    out[dealId] = {
      deal_id: dealId,
      status: readiness.status,
      last_generated_at: readiness.last_generated_at,
      missing_spreads: readiness.missing_spreads,
    };
  }

  return out;
}
