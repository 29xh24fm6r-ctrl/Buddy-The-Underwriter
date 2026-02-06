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
import { buildCreditMemoBindings } from "@/lib/creditMemo/buildBindings";
import { computeDealScore } from "@/lib/scoring/dealScoringEngine";
import { CONDITION_RULES, EXPECTED_DOCS, type LoanProductType as ConditionsProductType } from "@/lib/conditions/rules";
import { computeUnderwritingVerdict } from "@/lib/finance/underwriting/computeVerdict";
import type { UnderwritingResults } from "@/lib/finance/underwriting/results";
import { loadResearchForMemo } from "@/lib/creditMemo/canonical/loadResearchForMemo";

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

function bindingToMetric(
  value: number | null,
  source: string,
): { value: number | null; source: string; updated_at: string | null } {
  return {
    value,
    source: value !== null ? source : "Pending",
    updated_at: null,
  };
}

function isoDateOnly(d: Date) {
  // YYYY-MM-DD (stable across locales)
  return d.toISOString().slice(0, 10);
}

function toConditionsProduct(p: string | null | undefined): ConditionsProductType {
  switch (p) {
    case "SBA_7A": return "SBA_7A";
    case "SBA_504": return "SBA_504";
    case "CRE_TERM": case "REFINANCE": return "CRE";
    case "LINE_OF_CREDIT": return "LOC";
    default: return "TERM";
  }
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

    const [snapshot, collateralVals, bindings] = await Promise.all([
      buildDealFinancialSnapshotForBank({ dealId: args.dealId, bankId }),
      // Keep legacy collateral value accessors for AS-IS / stabilized fields not (yet) in snapshot.
      computeCollateralValues({ dealId: args.dealId, bankId }),
      buildCreditMemoBindings({ dealId: args.dealId, bankId }),
    ]);

    // Phase 1C/1G/3: Load loan request, pricing quote, document checklist, research in parallel
    const [loanReqResult, pricingQuoteResult, checklistResult, researchData] = await Promise.all([
      (sb as any)
        .from("deal_loan_requests")
        .select("*")
        .eq("deal_id", args.dealId)
        .order("created_at", { ascending: false })
        .limit(1),
      (sb as any)
        .from("deal_pricing_quotes")
        .select("*")
        .eq("deal_id", args.dealId)
        .eq("bank_id", bankId)
        .eq("status", "locked")
        .order("locked_at", { ascending: false, nullsFirst: false })
        .limit(1),
      (sb as any)
        .from("deal_documents")
        .select("checklist_key")
        .eq("deal_id", args.dealId)
        .eq("bank_id", bankId)
        .not("checklist_key", "is", null),
      loadResearchForMemo({ dealId: args.dealId, bankId }),
    ]);

    const loanReq = loanReqResult.data?.[0] as any | null;
    const pricingQuote = pricingQuoteResult.data?.[0] as any | null;
    const presentDocKeys = ((checklistResult.data ?? []) as any[])
      .map((r: any) => r.checklist_key)
      .filter(Boolean) as string[];

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

    // ===== Phase 1A: debt_yield and cap_rate =====
    const noiForRatios = metricValueFromSnapshot({ snapshot, metric: "noi_ttm", label: "NOI TTM" });
    const debtYield = (noiForRatios.value !== null && loanAmount.value !== null && loanAmount.value > 0)
      ? { value: noiForRatios.value / loanAmount.value, source: "Computed:NOI_TTM/LoanAmount", updated_at: null }
      : pendingMetric();
    const capRate = (noiForRatios.value !== null && collateralFromSnapshot.grossValue.value !== null && collateralFromSnapshot.grossValue.value > 0)
      ? { value: noiForRatios.value / collateralFromSnapshot.grossValue.value, source: "Computed:NOI_TTM/GrossCollateralValue", updated_at: null }
      : pendingMetric();

    // ===== Phase 1D: Risk factors from scoring engine =====
    const scoreResult = computeDealScore({ snapshot, decision: null, metadata: {} });
    const riskFactors: Array<{ risk: string; severity: "low" | "medium" | "high"; mitigants: string[] }> = [];
    for (const neg of scoreResult.drivers.negative) {
      const sev: "low" | "medium" | "high" = scoreResult.grade === "D" ? "high" : scoreResult.grade === "C" ? "medium" : "low";
      riskFactors.push({ risk: neg, severity: sev, mitigants: [] });
    }
    if (financial.dscrGlobal.value !== null && financial.dscrGlobal.value < 1.25 && !riskFactors.some(r => r.risk.includes("DSCR"))) {
      riskFactors.push({ risk: `Below-policy DSCR (${financial.dscrGlobal.value.toFixed(2)}x vs 1.25x minimum)`, severity: "high", mitigants: ["Consider additional collateral or guarantor support"] });
    }
    if (financial.dscrStressed300bps.value !== null && financial.dscrStressed300bps.value < 1.0) {
      riskFactors.push({ risk: `Stress sensitivity — stressed DSCR (${financial.dscrStressed300bps.value.toFixed(2)}x) below 1.0x`, severity: "high", mitigants: ["Consider interest rate cap or additional reserves"] });
    }

    // ===== Phase 1E: Policy exceptions =====
    const policyExceptions: Array<{ exception: string; rationale: string }> = [];
    if (financial.dscrGlobal.value !== null && financial.dscrGlobal.value < 1.25) {
      policyExceptions.push({ exception: `DSCR of ${financial.dscrGlobal.value.toFixed(2)}x is below policy minimum of 1.25x`, rationale: "Requires senior credit officer approval and enhanced monitoring" });
    }
    if (ltvGross.value !== null && ltvGross.value > 0.80) {
      policyExceptions.push({ exception: `LTV of ${(ltvGross.value * 100).toFixed(1)}% exceeds 80% policy guideline`, rationale: "Additional collateral support or PMI may be required" });
    }

    // ===== Phase 1F: Conditions from rules =====
    const condProduct = toConditionsProduct(loanReq?.product_type);
    const condIsSba = condProduct === "SBA_7A" || condProduct === "SBA_504" || condProduct === "SBA_EXPRESS";
    const condIsCre = condProduct === "CRE";
    const presentDocSet = new Set(presentDocKeys);
    const expectedDocs = EXPECTED_DOCS.filter(d => d.appliesWhen({ product: condProduct, hasRealEstateCollateral: condIsCre, isSba: condIsSba }));
    const missingDocKeys = new Set(expectedDocs.filter(d => !presentDocSet.has(d.key)).map(d => d.key));
    const conditionsPrecedent: string[] = [];
    for (const rule of CONDITION_RULES) {
      const res = rule.predicate({ missingKeys: missingDocKeys, product: condProduct, isSba: condIsSba, hasRealEstateCollateral: condIsCre });
      if (res.open) conditionsPrecedent.push(rule.title);
    }
    const conditionsOngoing = [
      "Annual audited/reviewed financial statements within 120 days of fiscal year-end",
      "Annual personal financial statement from all guarantors",
      "Maintain adequate property and liability insurance with Lender as additional insured/mortgagee",
      "Annual property tax and insurance escrow compliance",
      "Annual rent roll (if applicable to collateral type)",
      "No change of ownership or management without prior written consent",
      "Compliance with all environmental laws and regulations",
    ];

    // ===== Phase 1G: Proposed terms from pricing =====
    const proposedProduct = pricingQuote?.index_code
      ? `${loanReq?.product_type ?? "Term Loan"} — ${pricingQuote.index_code}`
      : loanReq?.product_type ?? "Pending";
    const proposedRate = pricingQuote
      ? { all_in_rate: pricingQuote.all_in_rate_pct != null ? Number(pricingQuote.all_in_rate_pct) : null, index: pricingQuote.index_code ?? "Pending", margin_bps: pricingQuote.spread_bps != null ? Number(pricingQuote.spread_bps) : null }
      : loanReq?.requested_rate_type
        ? { all_in_rate: null, index: loanReq.requested_rate_index ?? loanReq.requested_rate_type, margin_bps: loanReq.requested_spread_bps ?? null }
        : { all_in_rate: null, index: "Pending", margin_bps: null };
    const proposedRationale = pricingQuote
      ? `Based on locked pricing quote (${pricingQuote.index_code} + ${pricingQuote.spread_bps}bps)`
      : "Pending pricing analysis";

    // ===== Phase 1H: Stabilization status =====
    const occupancyVal = snapshot.occupancy_pct?.value_num;
    const isStabilized = occupancyVal !== null && (
      (occupancyVal <= 1 && occupancyVal >= 0.9) ||
      (occupancyVal > 1 && occupancyVal >= 90)
    );
    const stabilizationStatus = occupancyVal !== null
      ? (isStabilized ? "Stabilized" : "In Stabilization")
      : "Pending";

    // ===== Phase 1C: Loan request derived fields =====
    const loanReqPurpose = loanReq?.purpose ?? "Pending";
    const loanReqProduct = loanReq?.product_type ?? "—";
    const loanReqTermMonths = loanReq?.requested_term_months ?? null;
    const rateSummary = pricingQuote
      ? `${pricingQuote.index_code ?? ""} + ${pricingQuote.spread_bps ?? "—"}bps = ${Number(pricingQuote.all_in_rate_pct ?? 0).toFixed(2)}%`
      : loanReq?.requested_rate_type
        ? `${loanReq.requested_rate_type}${loanReq.requested_rate_index ? ` (${loanReq.requested_rate_index})` : ""}${loanReq.requested_spread_bps ? ` + ${loanReq.requested_spread_bps}bps` : ""}`
        : "—";

    // ===== Phase 2: Recommendation & Verdict =====
    const adsVal = financial.annualDebtService.value;
    const hasMinimalData = financial.dscrGlobal.value !== null || adsVal !== null;
    let recommendation: CanonicalCreditMemoV1["recommendation"];

    if (!hasMinimalData) {
      recommendation = {
        verdict: "pending",
        headline: "Recommendation pending — insufficient financial data.",
        risk_grade: "pending",
        risk_score: null,
        confidence: null,
        rationale: ["Upload financial documents to generate underwriting recommendation."],
        key_drivers: [],
        mitigants: [],
      };
    } else {
      // Build UnderwritingResults from snapshot
      const uwResults: UnderwritingResults = {
        policy_min_dscr: 1.25,
        annual_debt_service: adsVal,
        worst_year: null,
        worst_dscr: financial.dscrGlobal.value,
        avg_dscr: financial.dscrGlobal.value,
        weighted_dscr: financial.dscrGlobal.value,
        stressed_dscr: financial.dscrStressed300bps.value,
        cfads_trend: "unknown",
        revenue_trend: "unknown",
        flags: [],
        low_confidence_years: [],
        by_year: [],
      };

      const verdict = computeUnderwritingVerdict(uwResults);

      recommendation = {
        verdict: verdict.level,
        headline: verdict.headline,
        risk_grade: scoreResult.grade,
        risk_score: scoreResult.score,
        confidence: scoreResult.confidence,
        rationale: verdict.rationale,
        key_drivers: verdict.key_drivers,
        mitigants: verdict.mitigants,
      };
    }

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
        request_summary: loanReqPurpose,
      },

      key_metrics: {
        loan_amount: loanAmount,
        product: loanReqProduct,
        rate_summary: rateSummary,
        dscr_uw: financial.dscrGlobal,
        dscr_stressed: financial.dscrStressed300bps,
        ltv_gross: ltvGross,
        ltv_net: ltvNet,
        debt_yield: debtYield,
        cap_rate: capRate,
        stabilization_status: stabilizationStatus,
      },

      executive_summary: {
        narrative:
          "Canonical credit memo (deterministic) is now live. Missing values render as Pending and will auto-fill as spreads/facts land.",
      },

      transaction_overview: {
        loan_request: {
          purpose: loanReqPurpose,
          term_months: loanReqTermMonths,
          amount: loanAmount.value,
          product: loanReqProduct,
        },
      },

      borrower_sponsor: {
        background: "Pending",
        experience: "Pending",
        guarantor_strength: "Pending",
        sponsors: bindings.sponsors.map((s) => ({
          owner_entity_id: s.ownerEntityId,
          name: s.name,
          total_personal_income: bindingToMetric(s.totalPersonalIncome, `Facts:PERSONAL_INCOME.TOTAL_PERSONAL_INCOME`),
          wages_w2: bindingToMetric(s.wagesW2, `Facts:PERSONAL_INCOME.WAGES_W2`),
          sched_e_net: bindingToMetric(s.schedENet, `Facts:PERSONAL_INCOME.SCHED_E_NET`),
          k1_ordinary_income: bindingToMetric(s.k1OrdinaryIncome, `Facts:PERSONAL_INCOME.K1_ORDINARY_INCOME`),
          pfs_total_assets: bindingToMetric(s.totalAssets, `Facts:PFS.PFS_TOTAL_ASSETS`),
          pfs_total_liabilities: bindingToMetric(s.totalLiabilities, `Facts:PFS.PFS_TOTAL_LIABILITIES`),
          pfs_net_worth: bindingToMetric(s.netWorth, `Facts:PFS.PFS_NET_WORTH`),
        })),
      },

      global_cash_flow: {
        global_cash_flow: bindingToMetric(bindings.global.globalCashFlow, "Facts:FINANCIAL_ANALYSIS.GCF_GLOBAL_CASH_FLOW"),
        global_dscr: bindingToMetric(bindings.global.globalDscr, "Facts:FINANCIAL_ANALYSIS.GCF_DSCR"),
        cash_available: bindingToMetric(bindings.global.cashAvailable, "Computed:PERSONAL_INCOME + PROPERTY_CASH_FLOW"),
        personal_debt_service: bindingToMetric(bindings.global.personalDebtService, "Computed:SUM(PFS_ANNUAL_DEBT_SERVICE)"),
        living_expenses: bindingToMetric(bindings.global.livingExpenses, "Computed:SUM(PFS_LIVING_EXPENSES)"),
        total_obligations: bindingToMetric(bindings.global.totalObligations, "Computed:PERSONAL_DS + LIVING_EXPENSES"),
      },

      business_industry_analysis: researchData,

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
        collateral_coverage: discountedCoverage,
        stabilization_status: stabilizationStatus,
      },

      financial_analysis: {
        income_analysis: "Pending",
        noi: metricValueFromSnapshot({ snapshot, metric: "noi_ttm", label: "NOI TTM" }),
        debt_service: financial.annualDebtService,
        cash_flow_available: financial.cashFlowAvailable,
        excess_cash_flow: financial.excessCashFlow,
        dscr: financial.dscrGlobal,
        dscr_stressed: financial.dscrStressed300bps,
        debt_yield: debtYield,
        cap_rate: capRate,
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

      risk_factors: riskFactors,
      policy_exceptions: policyExceptions,

      proposed_terms: {
        product: proposedProduct,
        rate: proposedRate,
        rationale: proposedRationale,
      },

      conditions: {
        precedent: conditionsPrecedent,
        ongoing: conditionsOngoing,
      },

      recommendation,

      meta: {
        notes: [
          "This is the canonical memo shell; formulas + exact Moody's layout come next.",
          "Sections are locked; fields never disappear (Pending instead).",
        ],
        readiness,
        data_completeness: bindings.completeness,
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
