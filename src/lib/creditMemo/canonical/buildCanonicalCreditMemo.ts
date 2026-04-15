import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { dealLabel } from "@/lib/deals/dealLabel";
import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";
import type { DebtCoverageRow, IncomeStatementRow, GuarantorBudget } from "@/lib/creditMemo/canonical/types";
import {
  computeCollateralValues,
  computeDiscountedCoverageRatio,
  computeFinancialAnalysisMetrics,
  computeSourcesUsesMetrics,
  computeLtvPct,
  computeReadiness,
  getLatestSpread,
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
import { buildBalanceSheetTable } from "@/lib/creditMemo/canonical/buildBalanceSheetTable";

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
  return d.toISOString().slice(0, 10);
}

function formatCurrencySimple(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val.toFixed(0)}`;
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
        "id, bank_id, display_name, nickname, borrower_name, name, stage, loan_amount, borrower_id",
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

    const dealAmount = typeof deal.loan_amount === "number" ? deal.loan_amount : deal.loan_amount ? Number(deal.loan_amount) : null;

    const [snapshot, collateralVals, bindings] = await Promise.all([
      buildDealFinancialSnapshotForBank({ dealId: args.dealId, bankId }),
      computeCollateralValues({ dealId: args.dealId, bankId }),
      buildCreditMemoBindings({ dealId: args.dealId, bankId }),
    ]);

    // Phase 1C/1G/3: Load loan request, pricing quote, document checklist, research, pricing decision in parallel
    const [loanReqResult, pricingQuoteResult, checklistResult, researchData, pricingDecisionResult] = await Promise.all([
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
      (sb as any)
        .from("pricing_decisions")
        .select("*, pricing_scenarios(*), pricing_terms(*)")
        .eq("deal_id", args.dealId)
        .eq("bank_id", bankId)
        .maybeSingle(),
    ]);

    const loanReq = loanReqResult.data?.[0] as any | null;
    const pricingQuote = pricingQuoteResult.data?.[0] as any | null;
    const pricingDecision = pricingDecisionResult.data as any | null;
    const pricingScenario = pricingDecision?.pricing_scenarios as any | null;
    const pricingTerms = (pricingDecision?.pricing_terms as any[])?.[0] ?? null;
    const presentDocKeys = ((checklistResult.data ?? []) as any[])
      .map((r: any) => r.checklist_key)
      .filter(Boolean) as string[];

    // Phase 33: New parallel queries — borrower, owners, AI risk, structural pricing, period facts, overrides
    const [borrowerResult, ownersResult, aiRiskResult, structuralPricingResult, periodFactsResult, overridesResult] = await Promise.all([
      deal.borrower_id
        ? (sb as any).from("borrowers").select("naics_code, naics_description, legal_name, ein, city, state, entity_type").eq("id", deal.borrower_id).maybeSingle()
        : Promise.resolve({ data: null }),
      (sb as any).from("ownership_entities").select("*").eq("deal_id", args.dealId).limit(10),
      (sb as any).from("ai_risk_runs").select("grade, base_rate_bps, risk_premium_bps, result_json, created_at").eq("deal_id", args.dealId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      (sb as any).from("deal_structural_pricing").select("*").eq("deal_id", args.dealId).order("computed_at", { ascending: false }).limit(1).maybeSingle(),
      (sb as any)
        .from("deal_financial_facts")
        .select("fact_key, fact_value_num, fact_period_end")
        .eq("deal_id", args.dealId)
        .eq("is_superseded", false)
        .neq("resolution_status", "rejected")
        .in("fact_key", [
          "TOTAL_REVENUE", "NET_INCOME", "DEPRECIATION", "INTEREST_EXPENSE", "RENT_EXPENSE",
          "COST_OF_GOODS_SOLD", "GROSS_PROFIT", "TOTAL_OPERATING_EXPENSES", "OPERATING_INCOME", "EBITDA",
          // Tax return aliases (IRS terminology → accounting terminology)
          "GROSS_RECEIPTS", "ORDINARY_BUSINESS_INCOME", "M2_NET_INCOME", "SK_ORDINARY_INCOME",
        ])
        .not("fact_value_num", "is", null)
        .order("fact_period_end", { ascending: false })
        .limit(100),
      (sb as any)
        .from("deal_memo_overrides")
        .select("overrides")
        .eq("deal_id", args.dealId)
        .eq("bank_id", bankId)
        .maybeSingle(),
    ]);

    const overrides = (overridesResult?.data?.overrides ?? {}) as Record<string, any>;
    const borrower = borrowerResult.data as any | null;
    const ownerEntities = (ownersResult.data ?? []) as any[];
    const aiRisk = aiRiskResult.data as any | null;
    const pricingRow = structuralPricingResult.data as any | null;

    // Tax return key aliases: IRS terminology → canonical accounting keys.
    // Priority: INCOME_STATEMENT facts win — aliases only fill gaps.
    const TAX_RETURN_KEY_ALIASES: Record<string, string> = {
      GROSS_RECEIPTS: "TOTAL_REVENUE",
      ORDINARY_BUSINESS_INCOME: "NET_INCOME",
      M2_NET_INCOME: "NET_INCOME",
      SK_ORDINARY_INCOME: "NET_INCOME",
    };

    // Group period facts by period_end
    const factsByPeriod: Record<string, Record<string, number>> = {};
    for (const f of ((periodFactsResult.data ?? []) as any[])) {
      if (!factsByPeriod[f.fact_period_end]) factsByPeriod[f.fact_period_end] = {};
      const canonicalKey = TAX_RETURN_KEY_ALIASES[f.fact_key as string];
      if (canonicalKey) {
        // Only set alias if canonical key not already populated (INCOME_STATEMENT wins)
        if (factsByPeriod[f.fact_period_end][canonicalKey] === undefined) {
          factsByPeriod[f.fact_period_end][canonicalKey] = Number(f.fact_value_num);
        }
      } else {
        factsByPeriod[f.fact_period_end][f.fact_key] = Number(f.fact_value_num);
      }
    }

    // Pull metrics from snapshot first, then fall back to spread-derived facts
    // when the snapshot hasn't been seeded from the FINANCIAL_ANALYSIS fact pipeline yet.
    function mergeMetric(
      fromSnapshot: { value: number | null; source: string; updated_at: string | null },
      fromSpreads: { value: number | null; source: string; updated_at: string | null } | undefined,
    ): { value: number | null; source: string; updated_at: string | null } {
      if (fromSnapshot.value !== null) return fromSnapshot;
      if (fromSpreads && fromSpreads.value !== null) return fromSpreads;
      return fromSnapshot; // keep "Pending" source for readiness tracking
    }

    const snapshotFinancial = {
      cashFlowAvailable: metricValueFromSnapshot({ snapshot, metric: "cash_flow_available", label: "Cash Flow Available" }),
      annualDebtService: metricValueFromSnapshot({ snapshot, metric: "annual_debt_service", label: "Annual Debt Service" }),
      excessCashFlow: metricValueFromSnapshot({ snapshot, metric: "excess_cash_flow", label: "Excess Cash Flow" }),
      dscrGlobal: metricValueFromSnapshot({ snapshot, metric: "dscr", label: "DSCR" }),
      dscrStressed300bps: metricValueFromSnapshot({ snapshot, metric: "dscr_stressed_300bps", label: "Stressed DSCR (+300bps)" }),
    };

    // If any key metric is missing from the snapshot, fall back to spread-derived metrics.
    const needsSpreadFallback =
      snapshotFinancial.dscrGlobal.value === null ||
      snapshotFinancial.annualDebtService.value === null ||
      snapshotFinancial.cashFlowAvailable.value === null;

    const spreadFinancial = needsSpreadFallback
      ? await computeFinancialAnalysisMetrics({ dealId: args.dealId, bankId })
      : null;

    let financial = {
      cashFlowAvailable: mergeMetric(snapshotFinancial.cashFlowAvailable, spreadFinancial?.cashFlowAvailable),
      annualDebtService: mergeMetric(snapshotFinancial.annualDebtService, spreadFinancial?.annualDebtService),
      excessCashFlow: mergeMetric(snapshotFinancial.excessCashFlow, spreadFinancial?.excessCashFlow),
      dscrGlobal: mergeMetric(snapshotFinancial.dscrGlobal, spreadFinancial?.dscrGlobal),
      dscrStressed300bps: mergeMetric(snapshotFinancial.dscrStressed300bps, spreadFinancial?.dscrStressed300bps),
      annualDebtServiceStressed300bps: (() => {
        const ads = mergeMetric(snapshotFinancial.annualDebtService, spreadFinancial?.annualDebtService);
        if (ads.value === null) return { value: null, source: "Pending", updated_at: null };
        const stressedAds = ads.value * 1.03;
        return { value: stressedAds, source: `Computed:ADS*1.03 (300bps stress)`, updated_at: ads.updated_at };
      })(),
    };

    // Tier 3: raw-input computation — when spread computed rows are null,
    // read the underlying raw inputs directly and compute derived metrics.
    // This covers deals where the GCF spread was built as a formula template
    // but its inputs (FINANCIAL_ANALYSIS facts) were never written.
    const needsTier3 =
      financial.cashFlowAvailable.value === null ||
      financial.annualDebtService.value === null;

    if (needsTier3) {
      // CFA: prefer T12 NOI row as proxy for operating cash flow
      if (financial.cashFlowAvailable.value === null) {
        try {
          const t12 = await getLatestSpread({
            dealId: args.dealId,
            bankId,
            spreadType: "T12",
          });
          if (t12?.rendered_json?.rows) {
            const noiRow = t12.rendered_json.rows.find(
              (r: any) => String(r.key).toUpperCase() === "NOI"
            );
            const rawCell = noiRow?.values?.[0];
            const noiVal = typeof rawCell === "number" ? rawCell
              : rawCell && typeof rawCell === "object" && "value" in rawCell ? Number(rawCell.value)
              : null;
            if (noiVal !== null && Number.isFinite(noiVal)) {
              financial.cashFlowAvailable = {
                value: noiVal,
                source: "Spreads:T12.NOI",
                updated_at: t12.updated_at,
              };
            }
          }
        } catch {
          // non-fatal
        }
      }

      // ADS: prefer structural pricing estimate when no spread or fact value exists
      if (financial.annualDebtService.value === null && pricingRow?.annual_debt_service_est != null) {
        financial.annualDebtService = {
          value: Number(pricingRow.annual_debt_service_est),
          source: "StructuralPricing:annual_debt_service_est",
          updated_at: pricingRow.computed_at ?? null,
        };
      }

      // Recompute derived metrics now that inputs may be available
      if (financial.cashFlowAvailable.value !== null && financial.annualDebtService.value !== null) {
        const cfa = financial.cashFlowAvailable.value;
        const ads = financial.annualDebtService.value;

        if (financial.excessCashFlow.value === null) {
          financial.excessCashFlow = {
            value: cfa - ads,
            source: "Computed:CFA-ADS",
            updated_at: null,
          };
        }

        if (financial.dscrGlobal.value === null && ads > 0) {
          financial.dscrGlobal = {
            value: Math.round((cfa / ads) * 100) / 100,
            source: `Computed:${financial.cashFlowAvailable.source}/${financial.annualDebtService.source}`,
            updated_at: null,
          };
        }

        if (financial.annualDebtServiceStressed300bps.value === null) {
          financial.annualDebtServiceStressed300bps = {
            value: ads * 1.03,
            source: "Computed:ADS*1.03 (300bps stress)",
            updated_at: financial.annualDebtService.updated_at,
          };
        }
        if (financial.dscrStressed300bps.value === null && financial.annualDebtServiceStressed300bps.value !== null) {
          const stressedAds = financial.annualDebtServiceStressed300bps.value;
          financial.dscrStressed300bps = {
            value: Math.round((cfa / stressedAds) * 100) / 100,
            source: `Computed:${financial.cashFlowAvailable.source}/ADS_STRESSED`,
            updated_at: null,
          };
        }
      }
    }

    const snapshotSourcesUses = {
      totalProjectCost: metricValueFromSnapshot({ snapshot, metric: "total_project_cost", label: "Total Project Cost" }),
      borrowerEquity: metricValueFromSnapshot({ snapshot, metric: "borrower_equity", label: "Borrower Equity" }),
      borrowerEquityPct: metricValueFromSnapshot({ snapshot, metric: "borrower_equity_pct", label: "Borrower Equity %" }),
      bankLoanTotal: metricValueFromSnapshot({ snapshot, metric: "bank_loan_total", label: "Bank Loan Total" }),
    };

    // Fallback: if bank_loan_total is missing from snapshot, read from facts directly
    const needsSourcesFallback = snapshotSourcesUses.bankLoanTotal.value === null;
    const spreadSourcesUses = needsSourcesFallback
      ? await computeSourcesUsesMetrics({ dealId: args.dealId, bankId })
      : null;

    const sourcesUses = {
      totalProjectCost: mergeMetric(snapshotSourcesUses.totalProjectCost, spreadSourcesUses?.totalProjectCost),
      borrowerEquity: mergeMetric(snapshotSourcesUses.borrowerEquity, spreadSourcesUses?.borrowerEquity),
      borrowerEquityPct: mergeMetric(snapshotSourcesUses.borrowerEquityPct, spreadSourcesUses?.borrowerEquityPct),
      bankLoanTotal: mergeMetric(snapshotSourcesUses.bankLoanTotal, spreadSourcesUses?.bankLoanTotal),
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
        : { value: dealAmount, source: "Deal:loan_amount", updated_at: null };

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

    // Insurance conditions
    const insuranceConditions = [
      "Hazard insurance covering all business personal property at replacement value",
      "General liability insurance of not less than $1,000,000 with Lender as additional insured",
      "Workers' Compensation insurance as required by law",
    ];
    if (loanAmount.value !== null && loanAmount.value > 150_000) {
      insuranceConditions.push(`Life insurance assignment on principal guarantor in amount of ${formatCurrencySimple(Math.min(loanAmount.value, 500_000))}`);
    }

    // ===== Phase 1G: Proposed terms from pricing =====
    const scenarioStructure = pricingScenario?.structure as any | null;
    let proposedProduct: string;
    let proposedRate: { all_in_rate: number | null; index: string; margin_bps: number | null };
    let proposedRationale: string;

    if (pricingDecision && scenarioStructure) {
      proposedProduct = `${pricingScenario.product_type ?? "Term Loan"} — ${scenarioStructure.index_code ?? ""}`;
      proposedRate = {
        all_in_rate: scenarioStructure.all_in_rate_pct ?? null,
        index: scenarioStructure.index_code ?? "Pending",
        margin_bps: scenarioStructure.spread_bps ?? null,
      };
      proposedRationale = `${pricingDecision.decision}: ${pricingDecision.rationale}`;
    } else if (pricingQuote) {
      proposedProduct = `${loanReq?.product_type ?? "Term Loan"} — ${pricingQuote.index_code}`;
      proposedRate = {
        all_in_rate: pricingQuote.all_in_rate_pct != null ? Number(pricingQuote.all_in_rate_pct) : null,
        index: pricingQuote.index_code ?? "Pending",
        margin_bps: pricingQuote.spread_bps != null ? Number(pricingQuote.spread_bps) : null,
      };
      proposedRationale = `Based on locked pricing quote (${pricingQuote.index_code} + ${pricingQuote.spread_bps}bps)`;
    } else if (loanReq?.requested_rate_type) {
      proposedProduct = loanReq.product_type ?? "Pending";
      proposedRate = {
        all_in_rate: null,
        index: loanReq.requested_rate_index ?? loanReq.requested_rate_type,
        margin_bps: loanReq.requested_spread_bps ?? null,
      };
      proposedRationale = "Pending pricing analysis";
    } else {
      proposedProduct = loanReq?.product_type ?? "Pending";
      proposedRate = { all_in_rate: null, index: "Pending", margin_bps: null };
      proposedRationale = "Pending pricing analysis";
    }

    // Enrich risk factors from pricing decision
    if (pricingDecision?.risks && Array.isArray(pricingDecision.risks)) {
      for (const r of pricingDecision.risks) {
        if (r.risk && !riskFactors.some((existing: any) => existing.risk === r.risk)) {
          riskFactors.push({ risk: r.risk, severity: r.severity ?? "medium", mitigants: [] });
        }
      }
    }
    if (pricingDecision?.mitigants && Array.isArray(pricingDecision.mitigants)) {
      for (const m of pricingDecision.mitigants) {
        if (riskFactors.length > 0) {
          riskFactors[riskFactors.length - 1].mitigants.push(m.mitigant ?? String(m));
        }
      }
    }

    // Policy compliance from pricing scenario overlays
    if (pricingScenario?.policy_overlays && Array.isArray(pricingScenario.policy_overlays)) {
      for (const overlay of pricingScenario.policy_overlays) {
        if (overlay.impact && !policyExceptions.some((e: any) => e.exception === overlay.rule)) {
          policyExceptions.push({ exception: overlay.rule, rationale: overlay.impact });
        }
      }
    }

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
    const loanReqPurpose = loanReq?.purpose ?? loanReq?.use_of_proceeds ?? "Pending";
    const loanReqProduct = loanReq?.product_type ?? "—";
    const loanReqTermMonths = loanReq?.requested_term_months ?? null;
    const rateSummary = scenarioStructure
      ? `${scenarioStructure.index_code ?? ""} + ${scenarioStructure.spread_bps ?? "—"}bps = ${Number(scenarioStructure.all_in_rate_pct ?? 0).toFixed(2)}% [${pricingDecision?.decision ?? ""}]`
      : pricingQuote
        ? `${pricingQuote.index_code ?? ""} + ${pricingQuote.spread_bps ?? "—"}bps = ${Number(pricingQuote.all_in_rate_pct ?? 0).toFixed(2)}%`
        : loanReq?.requested_rate_type
          ? `${loanReq.requested_rate_type}${loanReq.requested_rate_index ? ` (${loanReq.requested_rate_index})` : ""}${loanReq.requested_spread_bps ? ` + ${loanReq.requested_spread_bps}bps` : ""}`
          : "—";

    // Key metrics rate fields
    const rateIndex = proposedRate.index;
    const rateSpreadPct = proposedRate.margin_bps !== null ? proposedRate.margin_bps / 100 : null;
    const rateInitialPct = proposedRate.all_in_rate;
    const rateType: "Fixed" | "Variable" | null =
      loanReq?.requested_rate_type === "FIXED" ? "Fixed" :
      loanReq?.requested_rate_type === "VARIABLE" ? "Variable" :
      null;
    const amortMonths = pricingRow?.amort_months ?? loanReq?.requested_amort_months ?? null;
    const monthlyPayment = pricingRow?.monthly_payment_est
      ? Number(pricingRow.monthly_payment_est)
      : (financial.annualDebtService.value !== null ? Math.round(financial.annualDebtService.value / 12) : null);
    const guarantyPct = condIsSba
      ? (loanAmount.value !== null && loanAmount.value <= 150_000 ? 85 : 75)
      : null;
    const sbaSop = condIsSba ? "SBA SOP 50 10 7" : null;

    // ===== Phase 2: Recommendation & Verdict =====
    const adsVal = financial.annualDebtService.value;
    const hasMinimalData = financial.dscrGlobal.value !== null || adsVal !== null;
    let recommendation: CanonicalCreditMemoV1["recommendation"];

    if (!hasMinimalData) {
      recommendation = {
        verdict: "pending",
        headline: "Recommendation pending — insufficient financial data.",
        risk_grade: aiRisk?.grade ?? "pending",
        risk_score: null,
        confidence: null,
        rationale: ["Upload financial documents to generate underwriting recommendation."],
        key_drivers: [],
        mitigants: [],
        exceptions: policyExceptions.map(e => e.exception),
      };
    } else {
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
        risk_grade: aiRisk?.grade ?? scoreResult.grade,
        risk_score: scoreResult.score,
        confidence: scoreResult.confidence,
        rationale: verdict.rationale,
        key_drivers: verdict.key_drivers,
        mitigants: verdict.mitigants,
        exceptions: policyExceptions.map(e => e.exception),
      };
    }

    // ===== Phase 33: Build debt_coverage_table =====
    const debtCoverageTable: DebtCoverageRow[] = [];
    const structuralAds = pricingRow?.annual_debt_service_est
      ? Number(pricingRow.annual_debt_service_est)
      : (financial.annualDebtService.value ?? null);

    for (const [period, facts] of Object.entries(factsByPeriod).slice(0, 3)) {
      const rev = facts["TOTAL_REVENUE"] ?? null;
      const ni = facts["NET_INCOME"] ?? null;
      const dep = facts["DEPRECIATION"] ?? null;
      const interest = facts["INTEREST_EXPENSE"] ?? null;
      const cfa = ni !== null ? (dep !== null ? ni + dep : ni) : null;
      const dscrVal = (cfa !== null && structuralAds !== null && structuralAds > 0) ? Math.round((cfa / structuralAds) * 100) / 100 : null;

      debtCoverageTable.push({
        label: period.slice(0, 10),
        period_end: period.slice(0, 10),
        months: 12,
        revenue: rev,
        net_income: ni,
        addback_rent: null,
        addback_interest: interest,
        addback_depreciation: dep,
        addback_officer_salary: null,
        deduct_payroll: null,
        deduct_officer_draw: null,
        cash_flow_available: cfa,
        debt_service: structuralAds,
        excess_cash_flow: cfa !== null && structuralAds !== null ? cfa - structuralAds : null,
        dscr: dscrVal,
        debt_service_stressed: structuralAds !== null ? Math.round(structuralAds * 1.03) : null,
        dscr_stressed: (cfa !== null && structuralAds !== null && structuralAds > 0) ? Math.round((cfa / (structuralAds * 1.03)) * 100) / 100 : null,
        is_projection: false,
      });
    }

    // ===== Phase 33: Build income_statement_table =====
    const incomeStatementTable: IncomeStatementRow[] = [];
    for (const [period, facts] of Object.entries(factsByPeriod).slice(0, 3)) {
      const rev = facts["TOTAL_REVENUE"] ?? null;
      const cogs = facts["COST_OF_GOODS_SOLD"] ?? null;
      const gp = facts["GROSS_PROFIT"] ?? (rev !== null && cogs !== null ? rev - cogs : null);
      const opex = facts["TOTAL_OPERATING_EXPENSES"] ?? null;
      const opinc = facts["OPERATING_INCOME"] ?? (gp !== null && opex !== null ? gp - opex : null);
      const ni = facts["NET_INCOME"] ?? null;
      const dep = facts["DEPRECIATION"] ?? null;
      const interest = facts["INTEREST_EXPENSE"] ?? null;
      // Derive EBITDA from NI + Depreciation + Interest when fact is missing
      const ebitda = facts["EBITDA"] ?? (ni !== null ? ni + (dep ?? 0) + (interest ?? 0) : null);

      incomeStatementTable.push({
        label: period.slice(0, 10),
        period_end: period.slice(0, 10),
        months: 12,
        revenue: rev,
        revenue_pct: null,
        cogs: cogs,
        cogs_pct: rev && cogs ? Math.round((cogs / rev) * 10000) / 100 : null,
        gross_profit: gp,
        gross_margin: rev && gp ? Math.round((gp / rev) * 10000) / 100 : null,
        operating_expenses: opex,
        opex_pct: rev && opex ? Math.round((opex / rev) * 10000) / 100 : null,
        operating_income: opinc,
        operating_margin: rev && opinc ? Math.round((opinc / rev) * 10000) / 100 : null,
        net_income: ni,
        net_margin: rev && ni ? Math.round((ni / rev) * 10000) / 100 : null,
        ebitda: ebitda,
        depreciation: dep,
        interest_expense: interest,
        is_projection: false,
      });
    }

    // ===== Phase BS: Build balance sheet table (permanent fix) =====
    // Reads directly from SL_ keyed facts in deal_financial_facts.
    // Fully independent of the BALANCE_SHEET spread row in deal_spreads —
    // will always populate as long as documents have been extracted.
    const balanceSheetTable = await buildBalanceSheetTable({ dealId: args.dealId, bankId });

    // ===== Phase 33: Build strengths & weaknesses =====
    const strengths: Array<{ point: string; detail: string | null }> = [];
    const weaknesses: Array<{ point: string; mitigant: string | null }> = [];

    if (aiRisk?.result_json?.factors) {
      for (const f of ((aiRisk.result_json as any).factors as any[])) {
        if (f.direction === "positive") {
          strengths.push({ point: f.label, detail: f.rationale ?? null });
        } else if (f.direction === "negative") {
          weaknesses.push({ point: f.label, mitigant: null });
        }
      }
    }

    if (financial.dscrGlobal.value !== null && financial.dscrGlobal.value >= 1.25) {
      strengths.push({ point: `Adequate debt service coverage (${financial.dscrGlobal.value.toFixed(2)}x)`, detail: null });
    } else if (financial.dscrGlobal.value !== null && financial.dscrGlobal.value < 1.25) {
      weaknesses.push({ point: `DSCR below policy minimum (${financial.dscrGlobal.value.toFixed(2)}x < 1.25x)`, mitigant: "Enhanced monitoring required" });
    }

    // ===== Phase 33: Build eligibility =====
    const isSbaDeal = (deal as any)?.deal_type === "SBA" ||
      (loanReq as any)?.product_type?.toUpperCase?.()?.includes("SBA") ||
      false;

    const eligibility: CanonicalCreditMemoV1["eligibility"] = {
      naics_code: borrower?.naics_code ?? null,
      naics_description: borrower?.naics_description ?? null,
      sba_size_standard_revenue: null,
      applicant_revenue: metricValueFromSnapshot({ snapshot, metric: "revenue", label: "Revenue" }).value,
      employee_count: null,
      is_exporter: null,
      franchise_name: null,
      naics_sba_stats: null,
      credit_available_elsewhere: isSbaDeal
        ? "Credit is not available elsewhere at equivalent terms without SBA guaranty assistance."
        : "Credit is not available from conventional sources at equivalent terms.",
      benefit_to_small_business: loanReqPurpose ||
        (isSbaDeal ? "Loan proceeds will provide capital needed for business growth." : ""),
    };

    // ===== Phase 33: Build management qualifications =====
    const managementQualifications: CanonicalCreditMemoV1["management_qualifications"] = {
      principals: ownerEntities.map((o: any) => {
        const bioKey = `principal_bio_${o.id}`;
        return {
          id: String(o.id),
          name: o.display_name ?? "Unknown",
          ownership_pct: o.ownership_pct ?? null,
          title: o.title ?? null,
          bio: overrides[bioKey] || "Pending — complete borrower interview to populate management qualifications.",
          years_experience: null,
          prior_roles: [],
          other_income_sources: null,
        };
      }),
    };

    // ===== Phase 33: Build personal financial statements =====
    const personalFinancialStatements: GuarantorBudget[] = bindings.sponsors.map((s: any) => ({
      owner_entity_id: s.ownerEntityId,
      name: s.name ?? null,
      pfs_date: null,
      credit_score: null,
      post_closing_liquidity: null,
      cash_equivalents: null,
      stocks_bonds: null,
      primary_residence_value: null,
      autos: null,
      retirement: null,
      total_assets: s.totalAssets ?? null,
      revolving_debt: null,
      installment_debt: null,
      real_estate_debt: null,
      total_liabilities: s.totalLiabilities ?? null,
      net_worth: s.netWorth ?? null,
      monthly_gross_salary: s.totalPersonalIncome !== null && s.totalPersonalIncome !== undefined ? s.totalPersonalIncome / 12 : null,
      monthly_rental_income: null,
      monthly_other_income: null,
      total_monthly_income: s.totalPersonalIncome !== null && s.totalPersonalIncome !== undefined ? s.totalPersonalIncome / 12 : null,
      annual_income: s.totalPersonalIncome ?? null,
      monthly_mortgage: null,
      monthly_heloc: null,
      monthly_auto_installment: null,
      monthly_revolving: null,
      monthly_living: null,
      monthly_taxes: null,
      monthly_misc: null,
      total_monthly_expenses: s.totalObligations !== null && s.totalObligations !== undefined ? s.totalObligations / 12 : null,
      annual_expenses: s.totalObligations ?? null,
      net_discretionary_income: (s.totalPersonalIncome != null && s.totalObligations != null) ? s.totalPersonalIncome - s.totalObligations : null,
    }));

    // ===== Phase 33: Collateral line items =====
    const collateralLineItems = [
      {
        description: collateralFromSnapshot.grossValue.value !== null ? "Real Property / Business Assets (Combined)" : "Pending — collateral appraisal required",
        address: "",
        gross_value: collateralFromSnapshot.grossValue.value,
        advance_rate_pct: 0.80,
        net_value: collateralFromSnapshot.netValue.value,
        prior_liens: null as number | null,
        net_equity: null as number | null,
        lien_position: "1st",
        is_existing: true,
      },
    ];

    const lifeInsuranceRequired = loanAmount.value !== null && loanAmount.value > 150_000;
    const lifeInsuranceAmount = lifeInsuranceRequired && loanAmount.value !== null
      ? Math.min(loanAmount.value, 500_000)
      : null;

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
        borrower_name: String(deal.borrower_name ?? borrower?.legal_name ?? "—"),
        guarantors: ownerEntities.map((o: any) => o.display_name ?? "Unknown").filter(Boolean),
        lender_name: "Buddy – The Underwriter",
        prepared_by: args.preparedBy ?? "Buddy",
        underwriting_assistance: aiRisk ? `Buddy AI Risk Assessment (${aiRisk.grade ?? "—"})` : null,
        date: isoDateOnly(new Date()),
        request_summary: loanReqPurpose,
        action_type: "Original Action",
      },

      key_metrics: {
        loan_amount: loanAmount,
        product: loanReqProduct,
        rate_summary: rateSummary,
        rate_index: rateIndex,
        rate_base_pct: null,
        rate_spread_pct: rateSpreadPct,
        rate_initial_pct: rateInitialPct,
        rate_type: rateType,
        term_months: loanReqTermMonths,
        amort_months: amortMonths !== null ? Number(amortMonths) : null,
        monthly_payment: monthlyPayment,
        guaranty_pct: guarantyPct,
        prepayment_penalty: "None",
        dscr_uw: financial.dscrGlobal,
        dscr_stressed: financial.dscrStressed300bps,
        ltv_gross: ltvGross,
        ltv_net: ltvNet,
        discounted_coverage: discountedCoverage,
        debt_yield: debtYield,
        cap_rate: capRate,
        stabilization_status: stabilizationStatus,
        sba_sop: sbaSop,
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
        equity_source_description: "Borrower cash equity",
      },

      eligibility,

      collateral: {
        property_description: overrides.collateral_description || "Pending",
        property_address: overrides.collateral_address || "",
        line_items: collateralLineItems,
        total_gross: collateralFromSnapshot.grossValue.value,
        total_net: collateralFromSnapshot.netValue.value,
        total_net_equity: null,
        loan_amount: loanAmount.value,
        discounted_coverage: discountedCoverage,
        ltv_gross: ltvGross,
        ltv_net: ltvNet,
        gross_value: collateralFromSnapshot.grossValue,
        net_value: collateralFromSnapshot.netValue,
        discounted_value: collateralFromSnapshot.discountedValue,
        valuation: {
          as_is: collateralVals.asIsValue,
          stabilized: collateralVals.stabilizedValue,
        },
        collateral_coverage: discountedCoverage,
        stabilization_status: stabilizationStatus,
        is_adequate: null,
        life_insurance_required: lifeInsuranceRequired,
        life_insurance_amount: lifeInsuranceAmount,
        life_insurance_insured: ownerEntities[0]?.display_name ?? null,
      },

      business_summary: {
        business_description: overrides.business_description || "Pending — complete borrower intake to populate business description.",
        date_established: null,
        years_in_operation: null,
        revenue_mix: overrides.revenue_mix || "Pending",
        seasonality: overrides.seasonality || "Pending",
        geography: borrower?.city && borrower?.state ? `${borrower.city}, ${borrower.state}` : "Pending",
        marketing_channels: [],
        competitive_advantages: overrides.competitive_advantages || "Pending",
        vision: overrides.vision || "Pending",
      },

      business_industry_analysis: researchData,

      management_qualifications: managementQualifications,

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
        revenue: metricValueFromSnapshot({ snapshot, metric: "revenue", label: "Revenue" }),
        ebitda: metricValueFromSnapshot({ snapshot, metric: "ebitda", label: "EBITDA" }),
        net_income: metricValueFromSnapshot({ snapshot, metric: "net_income", label: "Net Income" }),
        working_capital: metricValueFromSnapshot({ snapshot, metric: "working_capital", label: "Working Capital" }),
        current_ratio: metricValueFromSnapshot({ snapshot, metric: "current_ratio", label: "Current Ratio" }),
        debt_to_equity: metricValueFromSnapshot({ snapshot, metric: "debt_to_equity", label: "Debt-to-Equity" }),
        debt_coverage_table: debtCoverageTable,
        income_statement_table: incomeStatementTable,
        balance_sheet_table: balanceSheetTable,
        ratio_analysis: [],
        breakeven: {
          required_revenue: null,
          required_cogs: null,
          fixed_expenses: null,
          ebitda_at_breakeven: null,
          revenue_cushion_pct: null,
          narrative: "Pending — financial data required to compute breakeven analysis.",
        },
        repayment_notes: [],
        projection_feasibility: "Pending",
      },

      global_cash_flow: {
        global_cash_flow: bindingToMetric(bindings.global.globalCashFlow, "Facts:FINANCIAL_ANALYSIS.GCF_GLOBAL_CASH_FLOW"),
        global_dscr: bindingToMetric(bindings.global.globalDscr, "Facts:FINANCIAL_ANALYSIS.GCF_DSCR"),
        cash_available: bindingToMetric(bindings.global.cashAvailable, "Computed:PERSONAL_INCOME + PROPERTY_CASH_FLOW"),
        personal_debt_service: bindingToMetric(bindings.global.personalDebtService, "Computed:SUM(PFS_ANNUAL_DEBT_SERVICE)"),
        living_expenses: bindingToMetric(bindings.global.livingExpenses, "Computed:SUM(PFS_LIVING_EXPENSES)"),
        total_obligations: bindingToMetric(bindings.global.totalObligations, "Computed:PERSONAL_DS + LIVING_EXPENSES"),
        global_cf_table: [],
      },

      personal_financial_statements: personalFinancialStatements,

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

      risk_factors: riskFactors,

      strengths_weaknesses: {
        strengths,
        weaknesses,
      },

      policy_exceptions: policyExceptions,

      proposed_terms: {
        product: proposedProduct,
        rate: proposedRate,
        rationale: proposedRationale,
      },

      conditions: {
        precedent: conditionsPrecedent,
        ongoing: conditionsOngoing,
        insurance: insuranceConditions,
      },

      recommendation,

      meta: {
        notes: [],
        readiness,
        data_completeness: bindings.completeness,
        spreads: spreads.map((s: any) => ({
          spread_type: String(s.spread_type),
          status: String(s.status ?? "unknown"),
          updated_at: s.updated_at ?? null,
        })),
      },
    };

    // Phase 74: validate memo narrative contract (non-fatal, observability only)
    try {
      const { validateMemoNarrative } = await import(
        "@/lib/agentWorkflows/contracts/memoSection.contract"
      );
      const narrativeForValidation = {
        executiveSummary: memo.executive_summary?.narrative ?? "",
        cashFlowAnalysis: (memo.financial_analysis as any)?.cash_flow_narrative ?? memo.financial_analysis?.income_analysis ?? "",
        risks: memo.risk_factors?.map((r: any) => r.description ?? r.risk ?? "") ?? [],
        mitigants: memo.recommendation?.mitigants ?? [],
        recommendation: memo.recommendation?.headline ?? "",
      };
      const validation = validateMemoNarrative(narrativeForValidation);
      if (!validation.ok && validation.severity === "block") {
        console.warn("[buildCanonicalCreditMemo] memo narrative contract BLOCK:", validation.errors?.issues?.length, "issues");
      }
    } catch {
      // Contract validation must never block memo generation
    }

    return { ok: true, memo };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
