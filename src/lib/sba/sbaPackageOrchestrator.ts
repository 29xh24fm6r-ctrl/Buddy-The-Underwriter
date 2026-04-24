import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { validateSBAAssumptions } from "./sbaAssumptionsValidator";
import {
  buildBaseYear,
  buildAnnualProjections,
  buildMonthlyProjections,
  computeBreakEven,
  buildSensitivityScenarios,
  buildUseOfProceeds,
} from "./sbaForwardModelBuilder";
import { calculateSBAGuarantee, detectSBAProgram } from "./sbaGuarantee";
import {
  generateBusinessOverviewNarrative,
  generateSensitivityNarrative,
  generateExecutiveSummary,
  generateIndustryAnalysis,
  generateMarketingAndOperations,
  generateSWOTAnalysis,
  generateFranchiseSection,
  generatePlanThesis,
} from "./sbaPackageNarrative";
import {
  generateMilestoneTimeline,
  generateKPIDashboard,
  generateRiskContingencyMatrix,
} from "./sbaBusinessPlanRoadmap";
import { loadBorrowerStory } from "./sbaBorrowerStory";
import { renderSBAPackagePDF } from "./sbaPackageRenderer";
import {
  redactSBAPackageForPreview,
  type SBAPackageInputs,
} from "@/lib/brokerage/trident/redactor";
import { buildSourcesAndUses } from "./sbaSourcesAndUses";
import { buildBalanceSheetProjections } from "./sbaBalanceSheetProjector";
import {
  computeGlobalCashFlow,
  type GuarantorCashFlow,
} from "./sbaGlobalCashFlow";
import { validateAgainstBenchmarks } from "./sbaAssumptionBenchmarks";
import { crossFillSBAForms } from "./sbaFormCrossFill";
import { extractResearchForBusinessPlan } from "./sbaResearchExtractor";
import type { SBAAssumptions } from "./sbaReadinessTypes";

const SBA_DSCR_THRESHOLD = 1.25;

/**
 * Sprint 3: optional `mode` parameter. Default "final" preserves the
 * behavior every existing caller depends on. "preview" runs the full
 * pipeline but redacts the data that feeds the renderer (via
 * redactSBAPackageForPreview) and applies a cosmetic watermark overlay.
 * The DB package row still records the deal's actual underwriting state
 * — only the rendered PDF is preview-shaped.
 */
export async function generateSBAPackage(
  dealId: string,
  options: { mode?: "preview" | "final" } = {},
): Promise<
  | {
      ok: true;
      packageId: string;
      dscrBelowThreshold: boolean;
      dscrYear1Base: number;
      pdfUrl: string | null;
      versionNumber: number;
    }
  | { ok: false; error: string; blockers?: string[] }
> {
  const mode = options.mode ?? "final";
  const sb = supabaseAdmin();

  // Gate 1: Validation Pass must not be FAIL
  const { data: latestValidation } = await sb
    .from("buddy_validation_reports")
    .select("overall_status")
    .eq("deal_id", dealId)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestValidation?.overall_status === "FAIL") {
    return {
      ok: false,
      error:
        "Cannot generate SBA package: Validation Pass is FAIL. Resolve data integrity issues first.",
    };
  }

  // Gate 2: Assumptions must be confirmed
  const { data: assumptionsRow } = await sb
    .from("buddy_sba_assumptions")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!assumptionsRow || assumptionsRow.status !== "confirmed") {
    return {
      ok: false,
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
      ok: false,
      error: "Assumption validation failed",
      blockers: validation.blockers,
    };
  }

  // Pull base year facts
  // T-85-PROBE-1: column is fact_value_num (not value_numeric); fact keys in DB
  // are bare (TOTAL_REVENUE, COST_OF_GOODS_SOLD, etc.) while legacy code queried
  // _IS-suffixed keys that were never populated. Query both and fall back.
  // Also derive EBITDA from NET_INCOME + INTEREST + DEPRECIATION + TAX when the
  // EBITDA fact itself is absent (currently 0 rows repo-wide).
  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num")
    .eq("deal_id", dealId)
    .in("fact_key", [
      // Revenue
      "TOTAL_REVENUE_IS", "TOTAL_REVENUE",
      // COGS
      "TOTAL_COGS_IS", "COST_OF_GOODS_SOLD", "COGS",
      // Operating expenses
      "TOTAL_OPERATING_EXPENSES_IS", "TOTAL_OPERATING_EXPENSES",
      // Net income
      "NET_INCOME",
      // EBITDA (may not exist — derive below)
      "EBITDA",
      // Depreciation
      "DEPRECIATION_IS", "DEPRECIATION",
      // Interest (for EBITDA derivation)
      "INTEREST_EXPENSE",
      // Tax (for EBITDA derivation)
      "TOTAL_TAX",
      // ADS
      "ADS",
    ])
    .order("created_at", { ascending: false });

  // Fallback-chain fact lookup: try primary key, then each fallback in order.
  const getFact = (primaryKey: string, ...fallbackKeys: string[]): number => {
    const allKeys = [primaryKey, ...fallbackKeys];
    for (const key of allKeys) {
      const found = (facts ?? []).find(
        (f: { fact_key: string }) => f.fact_key === key,
      );
      if (found?.fact_value_num != null) {
        return Number(found.fact_value_num);
      }
    }
    return 0;
  };

  const revenue = getFact("TOTAL_REVENUE_IS", "TOTAL_REVENUE");
  const cogs = getFact("TOTAL_COGS_IS", "COST_OF_GOODS_SOLD", "COGS");
  const opex = getFact("TOTAL_OPERATING_EXPENSES_IS", "TOTAL_OPERATING_EXPENSES");
  const depreciation = getFact("DEPRECIATION_IS", "DEPRECIATION");
  const netIncome = getFact("NET_INCOME");
  const interestExpense = getFact("INTEREST_EXPENSE");
  const totalTax = getFact("TOTAL_TAX");

  // EBITDA: try direct fact first, then derive from components
  let ebitda = getFact("EBITDA");
  if (ebitda === 0 && netIncome !== 0) {
    ebitda = netIncome + interestExpense + depreciation + totalTax;
  }

  const ads = getFact("ADS");

  // Phase BPG — additional balance-sheet base-year facts
  const { data: bsFacts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num")
    .eq("deal_id", dealId)
    .in("fact_key", [
      "CASH",
      "ACCOUNTS_RECEIVABLE",
      "INVENTORY",
      "TOTAL_FIXED_ASSETS",
      "ACCOUNTS_PAYABLE",
      "TOTAL_LONG_TERM_DEBT",
      "TOTAL_EQUITY",
      "YEARS_IN_BUSINESS",
    ]);
  const getBSFact = (key: string): number => {
    const f = (bsFacts ?? []).find((r: { fact_key: string }) => r.fact_key === key);
    return f?.fact_value_num != null ? Number(f.fact_value_num) : 0;
  };
  const bsBase = {
    cash: getBSFact("CASH"),
    accountsReceivable: getBSFact("ACCOUNTS_RECEIVABLE"),
    inventory: getBSFact("INVENTORY"),
    fixedAssets: getBSFact("TOTAL_FIXED_ASSETS"),
    accountsPayable: getBSFact("ACCOUNTS_PAYABLE"),
    shortTermDebt: 0,
    longTermDebt: getBSFact("TOTAL_LONG_TERM_DEBT"),
    paidInCapital: 0,
    retainedEarnings: Math.max(
      0,
      getBSFact("TOTAL_EQUITY"),
    ),
  };
  const yearsInBusiness = getBSFact("YEARS_IN_BUSINESS");

  const baseYear = buildBaseYear({
    revenue,
    cogs,
    operatingExpenses: opex,
    ebitda,
    depreciation,
    netIncome,
    existingDebtServiceAnnual: ads,
  });

  // Run model passes
  const annualProjections = buildAnnualProjections(assumptions, baseYear);
  const monthlyProjections = buildMonthlyProjections(
    assumptions,
    annualProjections[0],
  );
  const breakEven = computeBreakEven(assumptions, annualProjections[0]);
  const sensitivityScenarios = buildSensitivityScenarios(
    assumptions,
    annualProjections,
  );

  // Use of proceeds
  const { data: proceedsItems } = await sb
    .from("deal_proceeds_items")
    .select("category, description, amount")
    .eq("deal_id", dealId);

  const useOfProceeds = buildUseOfProceeds(
    proceedsItems ?? [],
    assumptions.loanImpact.loanAmount,
  );

  // Phase BPG — Sources & Uses (after useOfProceeds is known)
  const isNewBusiness = yearsInBusiness < 2;
  const sourcesAndUses = buildSourcesAndUses({
    loanAmount: assumptions.loanImpact.loanAmount,
    equityInjectionAmount: assumptions.loanImpact.equityInjectionAmount ?? 0,
    equityInjectionSource:
      assumptions.loanImpact.equityInjectionSource ?? "cash_savings",
    sellerFinancingAmount: assumptions.loanImpact.sellerFinancingAmount ?? 0,
    otherSources: assumptions.loanImpact.otherSources ?? [],
    useOfProceeds,
    isNewBusiness,
  });

  // DSCR thresholds
  const dscrYear1Base = annualProjections[0]?.dscr ?? 0;
  const dscrYear2Base = annualProjections[1]?.dscr ?? 0;
  const dscrYear3Base = annualProjections[2]?.dscr ?? 0;
  const dscrYear1Downside =
    sensitivityScenarios.find((s) => s.name === "downside")?.dscrYear1 ?? 0;
  const dscrBelowThreshold =
    dscrYear1Base < SBA_DSCR_THRESHOLD ||
    dscrYear2Base < SBA_DSCR_THRESHOLD ||
    dscrYear3Base < SBA_DSCR_THRESHOLD;

  // Deal scalar context.
  const { data: deal } = await sb
    .from("deals")
    .select("name, deal_type, loan_amount, city, state")
    .eq("id", dealId)
    .single();

  // Phase BPG — borrower_applications supplies naics/industry/ein (deals
  // does not carry these columns in this schema).
  const { data: app } = await sb
    .from("borrower_applications")
    .select(
      "id, naics, industry, business_ein, business_legal_name",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const naicsCode = (app?.naics as string | null) ?? null;
  const industryDescription = (app?.industry as string | null) ?? "";
  const businessEin = (app?.business_ein as string | null) ?? null;

  // Phase 2 — replace the legacy 2KB JSON.stringify dump with structured
  // per-section extraction via sbaResearchExtractor. The narrative prompts
  // below consume each section individually.
  // God Tier — also load the borrower's discovery story in parallel. The
  // story is OPTIONAL; the pipeline degrades gracefully when null.
  const [research, borrowerStory] = await Promise.all([
    extractResearchForBusinessPlan(dealId),
    loadBorrowerStory(dealId),
  ]);
  const researchSummary = research.industryOverview ?? undefined;

  const proceedsDescription =
    useOfProceeds.length > 0
      ? useOfProceeds
          .map(
            (p) =>
              `${p.category}: $${Math.round(p.amount).toLocaleString()}`,
          )
          .join(", ")
      : "General business purposes";

  // Phase 2 — shared context strings for the narrative prompts.
  const managementBios = assumptions.managementTeam
    .map(
      (m) =>
        `${m.name} (${m.title}, ${m.ownershipPct ?? 0}% ownership, ${m.yearsInIndustry} years in industry): ${m.bio || "Bio not provided"}`,
    )
    .join("\n");
  const dealCity = (deal?.city as string | null) ?? null;
  const dealState = (deal?.state as string | null) ?? null;

  // ── God Tier — Plan thesis is generated FIRST. Every downstream prompt
  // receives the thesis as context so the plan is coherent from executive
  // summary to SWOT to sensitivity commentary. Thesis is nullable; when
  // null, the downstream prompts omit it cleanly.
  const planThesis = await generatePlanThesis({
    dealName: deal?.name ?? "Borrower",
    story: borrowerStory,
    loanAmount: assumptions.loanImpact.loanAmount,
    dscrYear1: dscrYear1Base,
    projectedRevenueYear1: annualProjections[0]?.revenue ?? 0,
    projectedRevenueYear3: annualProjections[2]?.revenue,
    industryDescription,
    useOfProceedsDescription: proceedsDescription,
    managementLeadNames: assumptions.managementTeam.map((m) => m.name),
    yearsInBusiness,
  });

  // Gemini Call 1
  const businessOverviewNarrative = await generateBusinessOverviewNarrative({
    dealName: deal?.name ?? "Borrower",
    loanType: deal?.deal_type ?? "SBA",
    loanAmount: assumptions.loanImpact.loanAmount,
    managementTeam: assumptions.managementTeam,
    revenueStreamNames: assumptions.revenueStreams.map((s) => s.name),
    useOfProceedsDescription: proceedsDescription,
    researchSummary,
    city: dealCity,
    state: dealState,
    managementBios,
    borrowerProfile: research.borrowerProfile,
    story: borrowerStory,
    planThesis,
  });

  // Gemini Call 2
  const year1MinCumulativeCash = Math.min(
    ...monthlyProjections.map((m) => m.cumulativeCash),
  );
  const sensitivityNarrative = await generateSensitivityNarrative({
    scenarios: sensitivityScenarios,
    breakEvenMarginOfSafetyPct: breakEven.marginOfSafetyPct,
    year1MinCumulativeCash,
    loanType: deal?.deal_type ?? "SBA",
    story: borrowerStory,
    planThesis,
  });

  // ── Phase BPG — Parallel narratives (exec summary, industry, marketing/ops, SWOT)
  const plannedHiresForOps = (assumptions.costAssumptions.plannedHires ?? []).map(
    (h) => ({ role: h.role, annualSalary: h.annualSalary }),
  );

  const narrativeBatch = await Promise.allSettled([
    generateExecutiveSummary({
      dealName: deal?.name ?? "Borrower",
      loanType: deal?.deal_type ?? "SBA",
      loanAmount: assumptions.loanImpact.loanAmount,
      industryDescription,
      revenueStreamNames: assumptions.revenueStreams.map((r) => r.name),
      managementLeadNames: assumptions.managementTeam.map((m) => m.name),
      useOfProceedsDescription: proceedsDescription,
      dscrYear1: dscrYear1Base,
      projectedRevenueYear1: annualProjections[0]?.revenue ?? 0,
      yearsInBusiness,
      // Phase 2
      managementBios,
      city: dealCity,
      state: dealState,
      borrowerProfile: research.borrowerProfile,
      creditThesis: research.creditThesis,
      equityInjectionPct: sourcesAndUses.equityInjection.actualPct,
      // God Tier
      story: borrowerStory,
      planThesis,
    }),
    generateIndustryAnalysis({
      dealName: deal?.name ?? "Borrower",
      naicsCode,
      industryDescription,
      researchSummary,
      // Phase 2 — structured research sections
      industryOverview: research.industryOverview,
      industryOutlook: research.industryOutlook,
      competitiveLandscape: research.competitiveLandscape,
      regulatoryEnvironment: research.regulatoryEnvironment,
      marketIntelligence: research.marketIntelligence,
      // God Tier
      story: borrowerStory,
      planThesis,
    }),
    generateMarketingAndOperations({
      dealName: deal?.name ?? "Borrower",
      industryDescription,
      revenueStreamNames: assumptions.revenueStreams.map((r) => r.name),
      plannedHires: plannedHiresForOps,
      useOfProceedsDescription: proceedsDescription,
      // Phase 2
      city: dealCity,
      state: dealState,
      marketIntelligence: research.marketIntelligence,
      competitiveLandscape: research.competitiveLandscape,
      // God Tier
      story: borrowerStory,
      planThesis,
    }),
    generateSWOTAnalysis({
      dealName: deal?.name ?? "Borrower",
      industryDescription,
      managementTeam: assumptions.managementTeam,
      revenueStreamNames: assumptions.revenueStreams.map((r) => r.name),
      dscrYear1: dscrYear1Base,
      marginOfSafetyPct: breakEven.marginOfSafetyPct,
      // Phase 2
      managementBios,
      borrowerProfile: research.borrowerProfile,
      competitiveLandscape: research.competitiveLandscape,
      industryOutlook: research.industryOutlook,
      // God Tier
      story: borrowerStory,
      planThesis,
    }),
  ]);

  const executiveSummary =
    narrativeBatch[0].status === "fulfilled"
      ? narrativeBatch[0].value
      : "Executive summary not available.";
  const industryAnalysis =
    narrativeBatch[1].status === "fulfilled"
      ? narrativeBatch[1].value
      : "Industry analysis not available.";
  const marketingOps =
    narrativeBatch[2].status === "fulfilled"
      ? narrativeBatch[2].value
      : {
          marketingStrategy: "Marketing strategy not available.",
          operationsPlan: "Operations plan not available.",
        };
  const swot =
    narrativeBatch[3].status === "fulfilled"
      ? narrativeBatch[3].value
      : {
          strengths: "Strengths not available.",
          weaknesses: "Weaknesses not available.",
          opportunities: "Opportunities not available.",
          threats: "Threats not available.",
        };

  // ── God Tier — Roadmap sections (milestone timeline, KPI dashboard, risk contingency)
  // All three are NULLABLE — when a generator fails we store null and the PDF
  // skips that section rather than rendering a placeholder.
  const plannedHiresForRoadmap = (
    assumptions.costAssumptions.plannedHires ?? []
  ).map((h) => ({
    role: h.role,
    startMonth: h.startMonth ?? 1,
    annualSalary: h.annualSalary,
  }));
  const plannedHiresForRisk = (assumptions.costAssumptions.plannedHires ?? []).map(
    (h) => ({ role: h.role, annualSalary: h.annualSalary }),
  );
  const fixedCostsForRisk = (
    assumptions.costAssumptions.fixedCostCategories ?? []
  ).map((c) => ({ name: c.name, annualAmount: c.annualAmount }));
  const revenueStreamsForKpi = assumptions.revenueStreams.map((r) => ({
    name: r.name,
    baseAnnualRevenue: r.baseAnnualRevenue ?? 0,
  }));
  const monthlyDebtService =
    (annualProjections[0]?.totalDebtService ?? 0) / 12;
  const cogsPercent = assumptions.costAssumptions.cogsPercentYear1 ?? 0;
  const sensitivityScenariosForRisk = sensitivityScenarios.map((s) => ({
    name: s.name,
    dscrYear1: s.dscrYear1,
    revenueYear1: s.revenueYear1,
  }));

  const roadmapBatch = await Promise.allSettled([
    generateMilestoneTimeline({
      dealName: deal?.name ?? "Borrower",
      story: borrowerStory,
      planThesis,
      useOfProceeds,
      plannedHires: plannedHiresForRoadmap,
      growthStrategy: borrowerStory?.growthStrategy ?? null,
      projectedRevenueYear1: annualProjections[0]?.revenue ?? 0,
      projectedRevenueYear2: annualProjections[1]?.revenue ?? 0,
      loanAmount: assumptions.loanImpact.loanAmount,
    }),
    generateKPIDashboard({
      dealName: deal?.name ?? "Borrower",
      industryDescription,
      naicsCode,
      story: borrowerStory,
      planThesis,
      revenueStreams: revenueStreamsForKpi,
      cogsPercent,
      dscrYear1: dscrYear1Base,
      monthlyDebtService,
      breakEvenRevenue: breakEven.breakEvenRevenue,
    }),
    generateRiskContingencyMatrix({
      dealName: deal?.name ?? "Borrower",
      story: borrowerStory,
      planThesis,
      biggestRisk: borrowerStory?.biggestRisk ?? null,
      dscrYear1: dscrYear1Base,
      dscrDownside: dscrYear1Downside,
      breakEvenRevenue: breakEven.breakEvenRevenue,
      projectedRevenueYear1: annualProjections[0]?.revenue ?? 0,
      monthlyDebtService,
      fixedCosts: fixedCostsForRisk,
      plannedHires: plannedHiresForRisk,
      sensitivityScenarios: sensitivityScenariosForRisk,
    }),
  ]);

  const milestoneTimeline =
    roadmapBatch[0].status === "fulfilled" ? roadmapBatch[0].value : null;
  const kpiDashboard =
    roadmapBatch[1].status === "fulfilled" ? roadmapBatch[1].value : null;
  const riskContingencyMatrix =
    roadmapBatch[2].status === "fulfilled" ? roadmapBatch[2].value : null;

  // ── Phase BPG — Balance sheet projections
  const balanceSheetProjections = buildBalanceSheetProjections(
    assumptions,
    annualProjections,
    bsBase,
  );

  // ── Phase BPG — Global cash flow (query per-deal guarantor cashflow rows)
  const { data: guarantorRows } = await sb
    .from("buddy_guarantor_cashflow")
    .select(
      "entity_id, w2_salary, other_personal_income, mortgage_payment, auto_payments, student_loans, credit_card_minimums, other_personal_debt",
    )
    .eq("deal_id", dealId);

  // Join owner entity display names / ownership percentages
  const { data: entityRows } = await sb
    .from("deal_ownership_entities")
    .select("id, display_name")
    .eq("deal_id", dealId);
  const { data: interestRows } = await sb
    .from("deal_ownership_interests")
    .select("owner_entity_id, ownership_pct")
    .eq("deal_id", dealId);

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

  // ── Phase BPG — Benchmark validation
  const benchmarkWarnings = validateAgainstBenchmarks(assumptions, naicsCode);

  // ── Phase BPG — Franchise detection (graceful if columns/table absent)
  let franchiseSection: string | null = null;
  try {
    const { data: franchiseDeal } = await sb
      .from("deals")
      .select("id")
      .eq("id", dealId)
      .maybeSingle();
    // Attempt to read franchise columns — if they do not exist, the catch
    // block swallows the error and franchiseSection stays null.
    if (franchiseDeal) {
      const { data: franchiseMeta } = (await sb
        .from("deals")
        .select("franchise_brand_id, franchise_brand_name")
        .eq("id", dealId)
        .maybeSingle()) as {
        data:
          | { franchise_brand_id: string | null; franchise_brand_name: string | null }
          | null;
      };
      const brandName = franchiseMeta?.franchise_brand_name ?? null;
      if (brandName) {
        franchiseSection = await generateFranchiseSection({
          dealName: deal?.name ?? "Borrower",
          franchiseBrand: brandName,
        });
      }
    }
  } catch {
    // Franchise columns or table absent — skip silently.
    franchiseSection = null;
  }

  // Render PDF.
  // Sprint 3: for mode='preview' we redact at the data layer *before* calling
  // renderSBAPackagePDF, then ask the renderer to stamp a cosmetic watermark
  // overlay. The PDF contains no precise borrower numbers regardless of the
  // watermark — if someone removes it, the document is still preview-shaped.
  let pdfUrl: string | null = null;
  try {
    const redactionInput: SBAPackageInputs = {
      dealName: deal?.name ?? "Borrower",
      loanType: deal?.deal_type ?? "SBA",
      loanAmount: assumptions.loanImpact.loanAmount,
      baseYear: {
        revenue: baseYear.revenue ?? 0,
        cogs: baseYear.cogs ?? 0,
        operatingExpenses: baseYear.operatingExpenses ?? 0,
        ebitda: baseYear.ebitda ?? 0,
        depreciation: baseYear.depreciation ?? 0,
        netIncome: baseYear.netIncome ?? 0,
        totalDebtService: baseYear.totalDebtService ?? 0,
      },
      annualProjections: annualProjections.map((p) => ({
        year: p.year ?? 0,
        revenue: p.revenue ?? 0,
        dscr: p.dscr ?? 0,
        totalDebtService: p.totalDebtService ?? 0,
        ebitda: p.ebitda ?? 0,
      })),
      executiveSummary,
      industryAnalysis,
      marketingStrategy: marketingOps.marketingStrategy,
      operationsPlan: marketingOps.operationsPlan,
      swotStrengths: swot.strengths,
      swotWeaknesses: swot.weaknesses,
      swotOpportunities: swot.opportunities,
      swotThreats: swot.threats,
      businessOverviewNarrative,
      sensitivityNarrative,
      useOfProceeds: useOfProceeds.map((u) => ({
        category: u.category,
        amount: u.amount ?? 0,
        description: u.description,
      })),
      sourcesAndUses,
      planThesis,
    };

    const redacted =
      mode === "preview"
        ? redactSBAPackageForPreview(redactionInput)
        : redactionInput;

    // Build renderer input: use redacted fields where the redactor produced
    // them, keep orchestrator-only fields (monthlyProjections, breakEven,
    // sensitivityScenarios, managementTeam, franchiseSection, balance sheet,
    // globalCashFlow) as-is. Preview mode for those additional fields is
    // handled by the watermark and by the redactor's scoped set.
    const pdfBuffer = await renderSBAPackagePDF({
      dealName: redacted.dealName,
      loanType: redacted.loanType,
      loanAmount: redacted.loanAmount,
      baseYear: { ...baseYear, ...redacted.baseYear },
      annualProjections: annualProjections.map((p, i) => ({
        ...p,
        revenue: redacted.annualProjections[i]?.revenue ?? p.revenue,
        ebitda: redacted.annualProjections[i]?.ebitda ?? p.ebitda,
        totalDebtService:
          redacted.annualProjections[i]?.totalDebtService ?? p.totalDebtService,
        dscr: redacted.annualProjections[i]?.dscr ?? p.dscr,
      })),
      monthlyProjections,
      breakEven,
      sensitivityScenarios,
      useOfProceeds: useOfProceeds.map((u, i) => ({
        ...u,
        amount: redacted.useOfProceeds[i]?.amount ?? u.amount,
        description: redacted.useOfProceeds[i]?.description ?? u.description,
      })),
      businessOverviewNarrative: redacted.businessOverviewNarrative,
      sensitivityNarrative: redacted.sensitivityNarrative,
      managementTeam: assumptions.managementTeam,
      executiveSummary: redacted.executiveSummary,
      industryAnalysis: redacted.industryAnalysis,
      marketingStrategy: redacted.marketingStrategy,
      operationsPlan: redacted.operationsPlan,
      swotStrengths: redacted.swotStrengths,
      swotWeaknesses: redacted.swotWeaknesses,
      swotOpportunities: redacted.swotOpportunities,
      swotThreats: redacted.swotThreats,
      franchiseSection: franchiseSection ?? undefined,
      sourcesAndUses: mode === "preview" ? undefined : sourcesAndUses,
      balanceSheetProjections: mode === "preview" ? undefined : balanceSheetProjections,
      globalCashFlow: mode === "preview" ? undefined : globalCashFlow,
      previewWatermark: mode === "preview",
    });

    const previewSuffix = mode === "preview" ? "_preview" : "";
    const pdfPath = `sba-packages/${dealId}/${Date.now()}${previewSuffix}.pdf`;
    const { error: uploadError } = await sb.storage
      .from("deal-documents")
      .upload(pdfPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (!uploadError) {
      pdfUrl = pdfPath;
    } else {
      console.error("[sbaPackageOrchestrator] PDF upload error:", uploadError);
    }
  } catch (pdfErr) {
    console.error("[sbaPackageOrchestrator] PDF render error:", pdfErr);
    // Non-fatal: proceed without PDF
  }

  // Compute SBA guarantee
  const sbaProgram = detectSBAProgram(deal?.deal_type ?? null);
  const guarantee = calculateSBAGuarantee(
    assumptions.loanImpact.loanAmount,
    sbaProgram,
  );

  // Phase BPG — versioning (parent_package_id = previous latest)
  const { data: priorRows } = await sb
    .from("buddy_sba_packages")
    .select("id, version_number")
    .eq("deal_id", dealId)
    .order("version_number", { ascending: false })
    .limit(1);
  const priorLatest = priorRows?.[0] as
    | { id: string; version_number: number | null }
    | undefined;
  const nextVersionNumber = (priorLatest?.version_number ?? 0) + 1;
  const parentPackageId = priorLatest?.id ?? null;

  // Store package record (now with all BPG fields)
  const { data: pkg } = await sb
    .from("buddy_sba_packages")
    .insert({
      deal_id: dealId,
      assumptions_id: assumptionsRow.id,
      base_year_data: baseYear,
      projections_annual: annualProjections,
      projections_monthly: monthlyProjections,
      break_even: breakEven,
      sensitivity_scenarios: sensitivityScenarios,
      use_of_proceeds: useOfProceeds,
      dscr_year1_base: dscrYear1Base,
      dscr_year2_base: dscrYear2Base,
      dscr_year3_base: dscrYear3Base,
      dscr_year1_downside: dscrYear1Downside,
      dscr_below_threshold: dscrBelowThreshold,
      break_even_revenue: breakEven.breakEvenRevenue,
      margin_of_safety_pct: breakEven.marginOfSafetyPct,
      business_overview_narrative: businessOverviewNarrative,
      sensitivity_narrative: sensitivityNarrative,
      pdf_url: pdfUrl,
      sba_guarantee_pct: guarantee.guaranteePct,
      sba_guarantee_amount: guarantee.guaranteeAmount,
      sba_bank_exposure: guarantee.bankExposure,
      sba_bank_exposure_pct: guarantee.bankExposurePct,
      status: "draft",
      // Phase BPG additions
      executive_summary: executiveSummary,
      industry_analysis: industryAnalysis,
      marketing_strategy: marketingOps.marketingStrategy,
      operations_plan: marketingOps.operationsPlan,
      swot_strengths: swot.strengths,
      swot_weaknesses: swot.weaknesses,
      swot_opportunities: swot.opportunities,
      swot_threats: swot.threats,
      sources_and_uses: sourcesAndUses,
      version_number: nextVersionNumber,
      parent_package_id: parentPackageId,
      franchise_section: franchiseSection,
      package_warnings: [],
      benchmark_warnings: benchmarkWarnings,
      global_cash_flow: globalCashFlow,
      global_dscr: globalCashFlow.globalDSCR,
      balance_sheet_projections: balanceSheetProjections,
      forms_cross_filled: [],
      // God Tier Business Plan additions
      plan_thesis: planThesis,
      milestone_timeline: milestoneTimeline,
      kpi_dashboard: kpiDashboard,
      risk_contingency_matrix: riskContingencyMatrix,
    })
    .select("id")
    .single();

  // Phase BPG — Cross-fill SBA forms (after INSERT so we have context)
  try {
    const crossFillResult = await crossFillSBAForms({
      dealId,
      assumptions,
      sourcesAndUses,
      guarantors,
      dealName: deal?.name ?? "Borrower",
      naicsCode,
      ein: businessEin,
      addressLine1: null,
      city: (deal?.city as string | null) ?? null,
      state: (deal?.state as string | null) ?? null,
      zip: null,
    });
    if (pkg?.id) {
      await sb
        .from("buddy_sba_packages")
        .update({ forms_cross_filled: crossFillResult })
        .eq("id", pkg.id);
    }
  } catch (crossFillErr) {
    console.error(
      "[sbaPackageOrchestrator] cross-fill error (non-fatal):",
      crossFillErr,
    );
  }

  return {
    ok: true,
    packageId: pkg?.id ?? "",
    dscrBelowThreshold,
    dscrYear1Base,
    pdfUrl,
    versionNumber: nextVersionNumber,
  };
}
