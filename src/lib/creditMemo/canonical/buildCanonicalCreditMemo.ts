import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { dealLabel } from "@/lib/deals/dealLabel";
import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";
import {
  computeCollateralValues,
  computeDiscountedCoverageRatio,
  computeLtvPct,
  computeReadiness,
  type RequiredMetric,
} from "@/lib/creditMemo/canonical/factsAdapter";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";
import type { DealFinancialSnapshotV1, SnapshotMetricName, SnapshotMetricValue } from "@/lib/deals/financialSnapshotCore";

function metricValueFromSnapshot(args: {
  snapshot: DealFinancialSnapshotV1;
  metric: SnapshotMetricName;
  label: string;
}): { value: number | null; source: string; updated_at: string | null } {
  const v: SnapshotMetricValue = (args.snapshot as any)[args.metric] as SnapshotMetricValue;
  const chosen = args.snapshot.sources_summary.find((s) => s.metric === args.metric)?.chosen;

  if (!v || (v.value_num === null && v.value_text === null)) {
    return { value: null, source: "Pending", updated_at: null };
  }

  return {
    value: v.value_num ?? null,
    source: chosen ? `Snapshot:${args.label}:${chosen.source_type}:${chosen.fact_type}.${chosen.fact_key}` : `Snapshot:${args.label}`,
    updated_at: chosen?.created_at ?? null,
  };
}

function isoDateOnly(d: Date) {
  // YYYY-MM-DD (stable across locales)
  return d.toISOString().slice(0, 10);
}

export async function buildCanonicalCreditMemo(args: {
  dealId: string;
  // When provided, enforces tenant via current user -> bank membership.
  // When omitted, builder will resolve bank_id from the deal row (meant for token-gated print/PDF flows).
  bankId?: string;
  preparedBy?: string;
}): Promise<{ ok: true; memo: CanonicalCreditMemoV1 } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    let bankId = args.bankId;
    if (!bankId) {
      const { data: dealRow, error: dealErr } = await (sb as any)
        .from("deals")
        .select("id, bank_id")
        .eq("id", args.dealId)
        .maybeSingle();

      if (dealErr) return { ok: false, error: `deal_select_failed:${dealErr.message}` };
      if (!dealRow) return { ok: false, error: "deal_not_found" };
      bankId = String(dealRow.bank_id);
    } else {
      const access = await ensureDealBankAccess(args.dealId);
      if (!access.ok) return { ok: false, error: access.error };
      if (String(access.bankId) !== String(bankId)) return { ok: false, error: "tenant_mismatch" };
    }

    const dealRes = await (sb as any)
      .from("deals")
      .select(
        "id, bank_id, display_name, nickname, borrower_name, name, stage, amount",
      )
      .eq("id", args.dealId)
      .eq("bank_id", bankId)
      .maybeSingle();

    if (dealRes.error) return { ok: false, error: `deal_select_failed:${dealRes.error.message}` };
    if (!dealRes.data) return { ok: false, error: "deal_not_found" };

    const deal = dealRes.data as any;

    const spreadsRes = await (sb as any)
      .from("deal_spreads")
      .select("spread_type, status, updated_at")
      .eq("deal_id", args.dealId)
      .eq("bank_id", bankId)
      .order("updated_at", { ascending: false })
      .limit(25);

    const spreads = spreadsRes.error ? [] : (spreadsRes.data ?? []);

    const dealAmount = typeof deal.amount === "number" ? deal.amount : deal.amount ? Number(deal.amount) : null;

    const [snapshot, collateralVals] = await Promise.all([
      buildDealFinancialSnapshotForBank({ dealId: args.dealId, bankId }),
      // Keep legacy collateral value accessors for AS-IS / stabilized fields not (yet) in snapshot.
      computeCollateralValues({ dealId: args.dealId, bankId }),
    ]);

    const financial = {
      cashFlowAvailable: metricValueFromSnapshot({ snapshot, metric: "cash_flow_available", label: "Cash Flow Available" }),
      annualDebtService: metricValueFromSnapshot({ snapshot, metric: "annual_debt_service", label: "Annual Debt Service" }),
      annualDebtServiceStressed300bps: { value: null, source: "Pending", updated_at: null },
      excessCashFlow: metricValueFromSnapshot({ snapshot, metric: "excess_cash_flow", label: "Excess Cash Flow" }),
      dscrGlobal: metricValueFromSnapshot({ snapshot, metric: "dscr", label: "DSCR" }),
      dscrStressed300bps: metricValueFromSnapshot({ snapshot, metric: "dscr_stressed_300bps", label: "Stressed DSCR (+300bps)" }),
    };

    const sourcesUses = {
      totalProjectCost: metricValueFromSnapshot({ snapshot, metric: "total_project_cost", label: "Total Project Cost" }),
      borrowerEquity: metricValueFromSnapshot({ snapshot, metric: "borrower_equity", label: "Borrower Equity" }),
      borrowerEquityPct: metricValueFromSnapshot({ snapshot, metric: "borrower_equity_pct", label: "Borrower Equity %" }),
      bankLoanTotal: metricValueFromSnapshot({ snapshot, metric: "bank_loan_total", label: "Bank Loan Total" }),
    };

    const snapshotGross = metricValueFromSnapshot({ snapshot, metric: "collateral_gross_value", label: "Gross Collateral Value" });
    const snapshotNet = metricValueFromSnapshot({ snapshot, metric: "collateral_net_value", label: "Net Collateral Value" });
    const snapshotDiscounted = metricValueFromSnapshot({ snapshot, metric: "collateral_discounted_value", label: "Discounted Collateral Value" });

    const collateralFromSnapshot = {
      ...collateralVals,
      grossValue: snapshotGross,
      netValue: snapshotNet,
      discountedValue: snapshotDiscounted,
    };

    const bankLoanTotal = sourcesUses.bankLoanTotal;
    const ltvGross = computeLtvPct({ loanAmount: bankLoanTotal.value, collateralValue: collateralFromSnapshot.grossValue, label: "LTV Gross" });
    const ltvNet = computeLtvPct({ loanAmount: bankLoanTotal.value, collateralValue: collateralFromSnapshot.netValue, label: "LTV Net" });
    const discountedCoverage = computeDiscountedCoverageRatio({
      discountedCollateralValue: collateralFromSnapshot.discountedValue,
      bankLoanTotal,
    });

    const requiredMetrics: RequiredMetric[] = [
      { key: "DSCR_GLOBAL", label: "DSCR", metric: financial.dscrGlobal },
      { key: "DSCR_STRESSED_300BPS", label: "Stressed DSCR (+300bps)", metric: financial.dscrStressed300bps },
      { key: "CASH_FLOW_AVAILABLE", label: "Cash Flow Available", metric: financial.cashFlowAvailable },
      { key: "ANNUAL_DEBT_SERVICE", label: "Annual Debt Service", metric: financial.annualDebtService },
      { key: "EXCESS_CASH_FLOW", label: "Excess Cash Flow", metric: financial.excessCashFlow },
      { key: "COLLATERAL_GROSS_VALUE", label: "Gross Collateral Value", metric: collateralFromSnapshot.grossValue },
      { key: "COLLATERAL_NET_VALUE", label: "Net Collateral Value", metric: collateralFromSnapshot.netValue },
      { key: "LTV_GROSS", label: "Gross LTV", metric: ltvGross },
      { key: "LTV_NET", label: "Net LTV", metric: ltvNet },
      { key: "DISCOUNTED_COVERAGE", label: "Discounted Coverage", metric: discountedCoverage },
      { key: "TOTAL_PROJECT_COST", label: "Total Project Cost", metric: sourcesUses.totalProjectCost },
      { key: "BORROWER_EQUITY", label: "Borrower Equity", metric: sourcesUses.borrowerEquity },
      { key: "BORROWER_EQUITY_PCT", label: "Borrower Equity %", metric: sourcesUses.borrowerEquityPct },
      { key: "BANK_LOAN_TOTAL", label: "Bank Loan Total", metric: sourcesUses.bankLoanTotal },
    ];

    const readiness = computeReadiness({
      spreads: spreads.map((s: any) => ({
        spread_type: String(s.spread_type),
        status: String(s.status ?? "unknown"),
        updated_at: s.updated_at ?? null,
      })),
      requiredMetrics,
    });

    const pendingMetric = () => ({ value: null, source: "Pending", updated_at: null });

    const loanAmount = sourcesUses.bankLoanTotal.value !== null
      ? sourcesUses.bankLoanTotal
      : dealAmount === null
        ? pendingMetric()
        : { value: dealAmount, source: "Deal:amount", updated_at: null };

    const memo: CanonicalCreditMemoV1 = {
      version: "canonical_v1",
      deal_id: String(deal.id),
      bank_id: String(bankId),
      generated_at: new Date().toISOString(),

      header: {
        deal_name: dealLabel({
          id: String(deal.id),
          display_name: deal.display_name ?? null,
          nickname: deal.nickname ?? null,
          borrower_name: deal.borrower_name ?? null,
          name: deal.name ?? null,
        }),
        borrower_name: String(deal.borrower_name ?? "—"),
        prepared_by: args.preparedBy ?? "Buddy",
        date: isoDateOnly(new Date()),
        request_summary: "Pending (wire from Deal Overview later).",
      },

      key_metrics: {
        loan_amount: loanAmount,
        product: "—",
        rate_summary: "—",
        dscr_uw: financial.dscrGlobal,
        dscr_stressed: financial.dscrStressed300bps,
        ltv_gross: ltvGross,
        ltv_net: ltvNet,
        debt_yield: pendingMetric(),
        cap_rate: pendingMetric(),
        stabilization_status: "—",
      },

      executive_summary: {
        narrative:
          "Canonical credit memo (deterministic) is now live. Missing values render as Pending and will auto-fill as spreads/facts land.",
      },

      transaction_overview: {
        loan_request: {
          purpose: "Pending",
          term_months: null,
          amount: loanAmount.value,
          product: "Pending",
        },
      },

      borrower_sponsor: {
        background: "Pending",
        experience: "Pending",
        guarantor_strength: "Pending",
      },

      collateral: {
        property_description: "Pending",
        property_address: "",
        gross_value: collateralFromSnapshot.grossValue,
        net_value: collateralFromSnapshot.netValue,
        discounted_value: collateralFromSnapshot.discountedValue,
        discounted_coverage: discountedCoverage,
        valuation: {
          as_is: collateralVals.asIsValue,
          stabilized: collateralVals.stabilizedValue,
        },
        collateral_coverage: pendingMetric(),
        stabilization_status: "Pending",
      },

      financial_analysis: {
        income_analysis: "Pending",
        noi: pendingMetric(),
        debt_service: financial.annualDebtService,
        cash_flow_available: financial.cashFlowAvailable,
        excess_cash_flow: financial.excessCashFlow,
        dscr: financial.dscrGlobal,
        dscr_stressed: financial.dscrStressed300bps,
        debt_yield: pendingMetric(),
        cap_rate: pendingMetric(),
      },

      sources_uses: {
        total_project_cost: sourcesUses.totalProjectCost,
        borrower_equity: sourcesUses.borrowerEquity,
        borrower_equity_pct: sourcesUses.borrowerEquityPct,
        bank_loan_total: sourcesUses.bankLoanTotal,
        sources: [
          { description: "Bank Loan", amount: sourcesUses.bankLoanTotal },
          { description: "Borrower Equity", amount: sourcesUses.borrowerEquity },
        ],
        uses: [
          { description: "Total Project Cost", amount: sourcesUses.totalProjectCost },
        ],
      },

      risk_factors: [],
      policy_exceptions: [],

      proposed_terms: {
        product: "Pending",
        rate: {
          all_in_rate: null,
          index: "Pending",
          margin_bps: null,
        },
        rationale: "Pending",
      },

      conditions: {
        precedent: [],
        ongoing: [],
      },

      meta: {
        notes: [
          "This is the canonical memo shell; formulas + exact Moody’s layout come next.",
          "Sections are locked; fields never disappear (Pending instead).",
        ],
        readiness,
        spreads: spreads.map((s: any) => ({
          spread_type: String(s.spread_type),
          status: String(s.status ?? "unknown"),
          updated_at: s.updated_at ?? null,
        })),
      },
    };

    return { ok: true, memo };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
