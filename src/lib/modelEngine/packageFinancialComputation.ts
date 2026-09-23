import "server-only";
import { assertPackageHistoricalConsistency } from "./packageHistoricalConsistency";
import { loadClassicSpreadData } from "@/lib/classicSpread/classicSpreadLoader";
import type { DebtCoverageRow } from "@/lib/creditMemo/canonical/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadPackageProjectionBasis } from "./packageProjectionBasis";
import { validateSBAAssumptions } from "@/lib/sba/sbaAssumptionsValidator";
import { computeSBAProjectionModel } from "@/lib/sba/sbaProjectionAuthority";
import { assertProjectionReconciliation } from "@/lib/sba/projectionReconciliation";
import { detectNewBusinessFromFacts, assessNewBusinessRisk } from "@/lib/sba/newBusinessProtocol";
import { buildSourcesAndUses } from "@/lib/sba/sbaSourcesAndUses";
import { computeGlobalCashFlow, type GuarantorCashFlow } from "@/lib/sba/sbaGlobalCashFlow";
import type { SBAAssumptions } from "@/lib/sba/sbaReadinessTypes";

/** The package extension of Model Engine V2. All existing calculators execute here, once. */
export async function computePackageFinancialOutput(dealId: string, bankId: string) {
  const sb = supabaseAdmin();
  // Gate 1: Validation Pass must not be FAIL
  const { data: latestValidation, error: validationError } = await sb
    .from("buddy_validation_reports")
    .select("overall_status")
    .eq("deal_id", dealId)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (validationError) throw validationError;
  if (latestValidation?.overall_status === "FAIL") {
    return {
      ok: false as const,
      error:
        "Cannot generate SBA package: Validation Pass is FAIL. Resolve data integrity issues first.",
    };
  }

  return computePackageFinancialModel(dealId, bankId);
}

/** Calculation only: validation consumes this same model before artifact admission.
 * Does not generate package artifacts or override validation admission. */
export async function computePackageFinancialModel(dealId: string, bankId: string) {
  const sb = supabaseAdmin();
  // Gate 2: Assumptions must be confirmed
  const { data: assumptionsRow, error: assumptionsError } = await sb
    .from("buddy_sba_assumptions")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (assumptionsError) throw assumptionsError;
  if (!assumptionsRow || assumptionsRow.status !== "confirmed") {
    return {
      ok: false as const,
      error: "Assumptions must be confirmed before generating the SBA package.",
    };
  }

  const assumptions: SBAAssumptions = {
    dealId,
    status: assumptionsRow.status,
    confirmedAt: assumptionsRow.confirmed_at ?? undefined,
    revenueStreams: assumptionsRow.revenue_streams,
    costAssumptions: assumptionsRow.cost_assumptions,
    workingCapital: assumptionsRow.working_capital,
    loanImpact: assumptionsRow.loan_impact,
    managementTeam: assumptionsRow.management_team,
  };

  // Gate 3: Validate assumption completeness
  const validation = validateSBAAssumptions(assumptions);
  if (!validation.ok) {
    return {
      ok: false as const,
      error: "Assumption validation failed",
      blockers: validation.blockers,
    };
  }

  const { deal, authority, periods, businessStage, preOpening, latest, opening, bsBase, baseYear, useOfProceeds } = await loadPackageProjectionBasis(dealId, bankId);
  const bsFacts = authority.facts;
  const yearsInBusiness = preOpening ? 0 : Number(bsFacts.find(f => f.fact_key === "YEARS_IN_BUSINESS")?.fact_value_num ?? 0);
  // New-business detection + risk assessment — single source of truth
  // (src/lib/sba/newBusinessProtocol.ts), same function sbaRiskProfile.ts
  // and feasibilityEngine.ts already call. This used to be a local
  // `yearsInBusiness < 2` one-off, independent of the canonical detector.
  const { yearsInBusiness: nbYears, monthsInBusiness: nbMonths } =
    detectNewBusinessFromFacts(
      (bsFacts ?? []).map((f: { fact_key: string; fact_value_num: unknown; fact_value_text: unknown }) => ({
        fact_key: f.fact_key,
        value_numeric:
          typeof f.fact_value_num === "number"
            ? f.fact_value_num
            : f.fact_value_num != null
              ? Number(f.fact_value_num)
              : null,
        value_text: (f.fact_value_text as string | null) ?? null,
      })),
    );
  const managementYearsInIndustry =
    assumptions.managementTeam.length > 0
      ? Math.max(...assumptions.managementTeam.map((m) => m.yearsInIndustry))
      : null;
  const newBusinessAssessment = assessNewBusinessRisk({
    yearsInBusiness: preOpening ? 0 : nbYears,
    monthsInBusiness: preOpening ? 0 : nbMonths,
    hasBusinessPlan: true,
    managementYearsInIndustry,
    loanType: deal?.deal_type ?? "SBA",
    loanAmount: deal?.loan_amount ?? null,
  });
  const isNewBusiness = newBusinessAssessment.flags.isNewBusiness;
  const projectedDscrThreshold = newBusinessAssessment.flags.projectedDscrThreshold;
  if (!isNewBusiness && (!latest || latest.income.revenue == null || latest.cashflow.ebitda == null || latest.balance.cash == null)) {
    throw new Error("financial_input_required: established business needs an accepted annual period, revenue, EBITDA basis, and opening cash; missing history cannot be replaced with zero");
  }

  // One versioned authority computes every borrower-facing SBA projection.
  // Artifacts consume this immutable model; they do not invoke individual
  // calculators or recompute financial values.
  // Freeze the canonical transaction uses before computing liquidity so
  // the monthly cash schedule and the Sources & Uses exhibit share one input.
  const projectionModel = computeSBAProjectionModel({
    assumptions,
    baseYear,
    projectedDscrThreshold,
    useOfProceeds,
    // Cash on hand at the start of the projection period. Without it the
    // monthly series is a net change that the renderer prints as a balance.
    openingCash: bsBase.cash,
    openingBalance: bsBase,
  });
  const {
    annualProjections,
    sensitivityScenarios,
  } = projectionModel;

  // Phase BPG — Sources & Uses (after useOfProceeds is known)
  const sourcesAndUses = buildSourcesAndUses({
    loanAmount: assumptions.loanImpact.loanAmount,
    equityInjectionAmount: assumptions.loanImpact.equityInjectionAmount ?? 0,
    equityInjectionSource:
      assumptions.loanImpact.equityInjectionSource ?? "cash_savings",
    sellerFinancingAmount: assumptions.loanImpact.sellerFinancingAmount ?? 0,
    otherSources: assumptions.loanImpact.otherSources ?? [],
    useOfProceeds,
    // Seller-note-as-equity inputs are not yet sourced from this assumption
    // bundle; default to zero / false so the seller-note check is a no-op
    // here. S2 will populate these from the deal-data builder.
    sellerNoteEquityPortion: 0,
    sellerNoteFullStandby: false,
    isNewBusiness,
  });

  // DSCR thresholds
  const dscrYear1Base = annualProjections[0]?.dscr ?? 0;
  const dscrYear2Base = annualProjections[1]?.dscr ?? 0;
  const dscrYear3Base = annualProjections[2]?.dscr ?? 0;
  const dscrYear1Downside =
    sensitivityScenarios.find((s) => s.name === "downside")?.dscrYear1 ?? 0;
  const dscrBelowThreshold =
    dscrYear1Base < projectedDscrThreshold ||
    dscrYear2Base < projectedDscrThreshold ||
    dscrYear3Base < projectedDscrThreshold ||
    dscrYear1Downside < projectedDscrThreshold;

  const balanceSheetProjections = projectionModel.balanceSheetProjections;

  if (opening) {
    const renderedOpening = balanceSheetProjections[0];
    if ([
      [renderedOpening.totalAssets, opening.balance.totalAssets],
      [renderedOpening.totalLiabilities, opening.balance.totalLiabilities],
      [renderedOpening.totalEquity, opening.balance.equity],
    ].some(([actual, expected]) => expected == null || Math.abs(actual! - expected) > 0.01)) {
      throw new Error("financial_input_required: the opening balance sheet needs asset, liability and equity details that reconcile to its totals. Missing amounts cannot be treated as zero.");
    }
  }

  assertProjectionReconciliation(projectionModel);

  // ── Phase BPG — Global cash flow (query per-deal guarantor cashflow rows)
  const { data: guarantorRows, error: guarantorError } = await sb
    .from("buddy_guarantor_cashflow")
    .select(
      "entity_id, w2_salary, other_personal_income, mortgage_payment, auto_payments, student_loans, credit_card_minimums, other_personal_debt",
    )
    .eq("deal_id", dealId);

  // Join owner entity display names / ownership percentages
  const { data: entityRows, error: entityError } = await sb
    .from("deal_ownership_entities")
    .select("id, display_name")
    .eq("deal_id", dealId);
  const { data: interestRows, error: interestError } = await sb
    .from("deal_ownership_interests")
    .select("owner_entity_id, ownership_pct")
    .eq("deal_id", dealId);

  if (guarantorError || entityError || interestError) throw guarantorError ?? entityError ?? interestError;
  const guarantors: GuarantorCashFlow[] = (guarantorRows ?? []).map(
    (g: {
      entity_id: string;
      w2_salary: number | null;
      other_personal_income: number | null;
      mortgage_payment: number | null;
      auto_payments: number | null;
      student_loans: number | null;
      credit_card_minimums: number | null;
      other_personal_debt: number | null;
    }) => {
      const entity = (entityRows ?? []).find(
        (e: { id: string }) => e.id === g.entity_id,
      );
      const interest = (interestRows ?? []).find(
        (i: { owner_entity_id: string }) => i.owner_entity_id === g.entity_id,
      );
      return {
        entityId: g.entity_id,
        name: entity?.display_name ?? "Guarantor",
        ownershipPct: Number(interest?.ownership_pct ?? 0),
        w2Salary: Number(g.w2_salary ?? 0),
        otherPersonalIncome: Number(g.other_personal_income ?? 0),
        mortgagePayment: Number(g.mortgage_payment ?? 0),
        autoPayments: Number(g.auto_payments ?? 0),
        studentLoans: Number(g.student_loans ?? 0),
        creditCardMinimums: Number(g.credit_card_minimums ?? 0),
        otherPersonalDebt: Number(g.other_personal_debt ?? 0),
      };
    },
  );

  const globalCashFlow = computeGlobalCashFlow({
    businessEbitda: baseYear.ebitda,
    businessDebtService:
      baseYear.totalDebtService > 0
        ? baseYear.totalDebtService
        : annualProjections[0]?.totalDebtService ?? 0,
    guarantors,
  });

  // Materialize the existing audited historical spread once, as part of this output.
  // Document workers consume the stored render input and never load/recompute it.
  const spreadInput = await loadClassicSpreadData(dealId, bankId);
  assertPackageHistoricalConsistency(authority.financialModel, spreadInput);
  if (preOpening && opening) {
    spreadInput.startup = {
      businessStage: "pre_opening", confirmedAt: assumptions.confirmedAt ?? "",
      openingDate: opening.periodEnd, openingBalance: opening.balance,
      projections: annualProjections,
    };
    const { startupSpreadBlockers } = await import("@/lib/classicSpread/startupSpread");
    const blockers = startupSpreadBlockers(spreadInput.startup);
    if (blockers.length) throw new Error(`financial_input_required: ${blockers.join(" ")}`);
  }
  const year1 = annualProjections[0];
  const metric = (value: number | null, basis: string) => ({ value, source: `ModelV2:${basis}`, updated_at: assumptions.confirmedAt ?? null });
  const memoFinancial = {
    cashFlowAvailable: metric(year1.ebitda, "Projected Year 1 EBITDA"),
    annualDebtService: metric(year1.totalDebtService, "Projected Year 1 total debt service"),
    excessCashFlow: metric(year1.ebitda - year1.totalDebtService, "Projected Year 1 excess cash flow"),
    dscrGlobal: { ...metric(year1.dscr, "Projected Year 1 business DSCR; not guarantor global DSCR"), preliminary: true,
      caveat: "Borrower-confirmed projections; lender confirmation required." },
    dscrStressed300bps: metric(null, "Rate stress not supplied; downside revenue scenario is separate"),
    annualDebtServiceStressed300bps: metric(null, "Rate stress not supplied"),
  };
  const debtCoverageRows: DebtCoverageRow[] = periods.map(p => {
    const cfa = p.cashflow.cfads ?? p.cashflow.ebitda ?? null;
    const debt = p.cashflow.annualDebtService ?? null;
    return { label: p.periodEnd, period_end: p.periodEnd, months: p.type === "YTD" ? Number(p.periodEnd.slice(5,7)) : 12,
      revenue: p.income.revenue ?? null, net_income: p.income.netIncome ?? null,
      addback_rent: null, addback_interest: p.income.interest ?? null, addback_depreciation: p.income.depreciation ?? null,
      addback_officer_salary: null, deduct_payroll: null, deduct_officer_draw: null,
      cash_flow_available: cfa, debt_service: debt, excess_cash_flow: cfa !== null && debt !== null ? cfa - debt : null,
      dscr: cfa !== null && debt !== null && debt > 0 ? cfa / debt : null,
      debt_service_stressed: null, dscr_stressed: null, is_projection: false };
  });
  const fundingMetrics = {
    totalProjectCost: metric(sourcesAndUses.totalUses, "Sources and uses total"),
    borrowerEquity: metric(assumptions.loanImpact.equityInjectionAmount, "Confirmed equity"),
    borrowerEquityPct: metric(sourcesAndUses.totalUses > 0 ? assumptions.loanImpact.equityInjectionAmount / sourcesAndUses.totalUses * 100 : null, "Confirmed equity percent"),
    bankLoanTotal: metric(assumptions.loanImpact.loanAmount, "Confirmed proposed loan"),
  };
  const memoFunding = {
    total_project_cost: fundingMetrics.totalProjectCost, borrower_equity: fundingMetrics.borrowerEquity,
    borrower_equity_pct: fundingMetrics.borrowerEquityPct, bank_loan_total: fundingMetrics.bankLoanTotal,
    sources: sourcesAndUses.sources.map(row => ({ description: row.label, amount: metric(row.amount, "Saved sources and uses") })),
    uses: sourcesAndUses.uses.map(row => ({ description: row.label, amount: metric(row.amount, "Saved sources and uses") })),
    equity_source_description: assumptions.loanImpact.equityInjectionSource?.replace(/_/g, " ") ?? "Source not supplied",
  };
  return { ok: true as const, output: {
    spreadInput, memoFinancial, debtCoverageRows, fundingMetrics, memoFunding,
    assumptions, assumptionsId: assumptionsRow.id as string, deal,
    historicalModel: authority.financialModel, historicalView: authority.viewModel,
    computedMetrics: authority.computedMetrics, riskFlags: authority.riskFlags,
    businessStage, openingBalance: opening?.balance ?? null, yearsInBusiness, newBusinessAssessment, isNewBusiness, projectedDscrThreshold,
    baseYear, projectionModel, sourcesAndUses, useOfProceeds,
    balanceSheetProjections, globalCashFlow, guarantors,
    dscrYear1Base, dscrYear2Base, dscrYear3Base, dscrYear1Downside, dscrBelowThreshold,
  } };
}
export type PackageFinancialOutput = Extract<Awaited<ReturnType<typeof computePackageFinancialOutput>>, { ok: true }>["output"];
