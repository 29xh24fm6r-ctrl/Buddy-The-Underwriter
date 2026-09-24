import { fundingScheduleText } from "@/lib/ai/packageNarrativeEvidence";
import "server-only";
import { loadPackageBorrowerContext } from "./packageBorrowerContext";
import { preparePackageFinancialSnapshot, loadPackageFinancialSnapshot } from "@/lib/modelEngine/packageFinancialSnapshot";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { calculateSBAGuarantee, detectSBAProgram } from "./sbaGuarantee";
import {
  generateBusinessOverviewNarrative,
  generateSensitivityNarrative,
  generateExecutiveSummary,
  generateIndustryAnalysis,
  generateMarketingAndOperations,
  generateSWOTAnalysis,
  generatePlanThesis,
  generateFranchiseSection,
} from "./sbaPackageNarrative";
import {
  generateMilestoneTimeline,
  generateKPIDashboard,
  generateRiskContingencyMatrix,
} from "./sbaBusinessPlanRoadmap";
import { loadBorrowerStory } from "./sbaBorrowerStory";
import {
  renderSBAPackagePDF,
  type SBAPackageRenderInput,
} from "./sbaPackageRenderer";
import {
  redactSBAPackageForPreview,
  redactMonthlyProjectionsForPreview,
  redactBreakEvenForPreview,
  redactSensitivityScenariosForPreview,
  redactRevenueStreamProjectionsForPreview,
  type SBAPackageInputs,
} from "@/lib/brokerage/trident/redactor";
import { validateAgainstBenchmarks } from "./sbaAssumptionBenchmarks";
import { crossFillSBAForms } from "./sbaFormCrossFill";
import { extractResearchForBusinessPlan } from "./sbaResearchExtractor";
import { generateProjectionsAssumptionsNarrative } from "@/lib/methodology/projectionsAssumptionsNarrative";

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
  options: { mode?: "preview" | "final"; financialSnapshotId?: string } = {},
): Promise<
  | {
      ok: true;
      packageId: string;
      dscrBelowThreshold: boolean;
      dscrYear1Base: number;
      pdfUrl: string;
      versionNumber: number;
      /** Exact deterministic input used for the initial render. */
      renderInput: SBAPackageRenderInput;
    }
  | { ok: false; error: string; blockers?: string[] }
> {
  const mode = options.mode ?? "final";
  const sb = supabaseAdmin();

  const financialSnapshot = options.financialSnapshotId
    ? await loadPackageFinancialSnapshot({ dealId, snapshotId: options.financialSnapshotId })
    : await preparePackageFinancialSnapshot({ dealId });
  const { output: financialOutput } = financialSnapshot;
  const { assumptions, deal: snapshotDeal, yearsInBusiness,
    projectedDscrThreshold, baseYear, projectionModel, sourcesAndUses, useOfProceeds,
    balanceSheetProjections, globalCashFlow, guarantors, dscrYear1Base, dscrYear2Base, dscrYear3Base,
    dscrYear1Downside, dscrBelowThreshold } = financialOutput;
  const borrowerContext = await loadPackageBorrowerContext(sb, dealId, snapshotDeal.bank_id);
  const deal = { ...snapshotDeal, name: borrowerContext.name, city: borrowerContext.city, state: borrowerContext.state };
  const assumptionsRow = { id: financialOutput.assumptionsId };
  const { annualProjections, monthlyProjections, revenueStreamProjections, breakEven, sensitivityScenarios } = projectionModel;

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

  const naicsCode = borrowerContext.naics;
  const industryDescription = borrowerContext.industry ?? "";
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

  // Preserve actual source descriptions, especially specific uses categorized
  // as "other", in every initial narrative rather than losing them to enum labels.
  const proceedsDescription = fundingScheduleText(sourcesAndUses) + " " +
    (sourcesAndUses.balanced
      ? "Sources and uses balance."
      : `Sources and uses are not balanced; unresolved difference: $${Math.abs(Math.round(sourcesAndUses.imbalance)).toLocaleString()}. Do not describe the project as fully funded.`);

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
    dscrThreshold: projectedDscrThreshold,
    sensitivityScenarios,
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
    dscrThreshold: projectedDscrThreshold,
    sensitivityScenarios,
    dscrYear1: dscrYear1Base,
    managementTeam: assumptions.managementTeam,
    revenueStreamNames: assumptions.revenueStreams.map((s) => s.name),
    revenueStreamSummaries: assumptions.revenueStreams.map((s) => ({
      name: s.name,
      pricingModel: s.pricingModel,
      baseAnnualRevenue: s.baseAnnualRevenue,
      growthRateYear1: s.growthRateYear1,
    })),
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
    dscrThreshold: projectedDscrThreshold,
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
      dscrThreshold: projectedDscrThreshold,
      sensitivityScenarios,
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
      existingDebtService: assumptions.loanImpact.existingDebt.reduce(
        (sum, debt) => sum + ((debt.treatment ?? "retain") === "retain"
          ? debt.monthlyPayment * Math.min(12, Math.max(0, debt.remainingTermMonths))
          : 0),
        0,
      ),
      newDebtService: Math.max(
        0,
        (annualProjections[0]?.totalDebtService ?? 0) -
          assumptions.loanImpact.existingDebt.reduce(
            (sum, debt) => sum + ((debt.treatment ?? "retain") === "retain"
              ? debt.monthlyPayment * Math.min(12, Math.max(0, debt.remainingTermMonths))
              : 0),
            0,
          ),
      ),
      totalDebtService: annualProjections[0]?.totalDebtService ?? 0,
      sellerFinancingAmount: assumptions.loanImpact.sellerFinancingAmount ?? 0,
      dscrYear1: dscrYear1Base,
      sourcesAndUses,
      sensitivityScenarios,
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
      sensitivityScenarios,
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
    dscrYear2: s.dscrYear2,
    dscrYear3: s.dscrYear3,
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
      projectedDscrThreshold,
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

  // ── Phase BPG — Benchmark validation
  const benchmarkWarnings = validateAgainstBenchmarks(assumptions, naicsCode);

  // ── Phase BPG — Franchise detection
  // deal_franchises links a deal to its franchise_brands row (one brand per
  // deal) — same lookup feasibilityEngine.ts's "9. Franchise detection"
  // step uses. Was previously hardcoded null with a comment claiming no
  // such link existed; deal_franchises has existed and been in active use
  // by the borrower-facing franchise-picker routes since 2026-07-12.
  // Gracefully degrades to null on any failure (missing table, no link,
  // RLS) — a franchise section is a bonus, never a reason to fail the
  // whole package.
  let franchiseSection: string | null = null;
  try {
    const { data: franchiseLink } = await sb
      .from("deal_franchises")
      .select("brand_id")
      .eq("deal_id", dealId)
      .maybeSingle();
    const franchiseBrandId = (franchiseLink as { brand_id?: string } | null)?.brand_id ?? null;

    if (franchiseBrandId) {
      const { data: brandRow } = await sb
        .from("franchise_brands")
        .select("brand_name, initial_investment_min, initial_investment_max, unit_count, has_item_19")
        .eq("id", franchiseBrandId)
        .maybeSingle();

      if (brandRow?.brand_name) {
        // Latest AVERAGE_GROSS_REVENUE reading — same metric
        // franchiseComparator.ts uses for cross-brand comparison, so the
        // business plan and the feasibility study cite the same figure.
        let item19Avg: number | undefined;
        if (brandRow.has_item_19) {
          const { data: item19Row } = await sb
            .from("fdd_item19_facts")
            .select("value")
            .eq("brand_id", franchiseBrandId)
            .eq("metric_name", "AVERAGE_GROSS_REVENUE")
            .order("filing_year", { ascending: false })
            .limit(1)
            .maybeSingle();
          item19Avg = (item19Row as { value?: number } | null)?.value ?? undefined;
        }

        franchiseSection = await generateFranchiseSection({
          dealName: deal?.name ?? "Borrower",
          franchiseBrand: brandRow.brand_name,
          fddItem7Min: brandRow.initial_investment_min ?? undefined,
          fddItem7Max: brandRow.initial_investment_max ?? undefined,
          fddItem19Avg: item19Avg,
          unitCount: brandRow.unit_count ?? undefined,
        });
      }
    }
  } catch (e) {
    console.warn(
      "[sbaPackageOrchestrator] franchise section lookup failed (non-fatal):",
      e instanceof Error ? e.message : String(e),
    );
  }

  // Final packages require a reviewed narrative based on the saved financial output.
  let projectionsAssumptionsNarrative: string | null = null;
  try {
    if (deal?.bank_id) {
      const year1Projection = annualProjections[0];
      const projectionsResult = await generateProjectionsAssumptionsNarrative(
        dealId,
        deal.bank_id,
        sb,
        {
          engineVersion: projectionModel.engineVersion,
          financialSnapshotId: financialSnapshot.id,
          annualProjections, monthlyProjections, sourcesAndUses, balanceSheetProjections,
          baseYear, sensitivityScenarios, breakEven,
          methodologySlate: "borrower_confirmed_sba_assumptions",
          formType: "SBA_FORWARD_MODEL",
          projectedEbitda: year1Projection?.ebitda ?? 0,
          projectedOfficerCompAddback: null,
          projectedNcads: year1Projection?.ebitda ?? 0,
          proposedAnnualDebtService: year1Projection?.proposedLoanDebtService ?? 0,
          existingAnnualDebtService: year1Projection?.existingDebtService ?? 0,
          sellerAnnualDebtService: year1Projection?.sellerDebtService ?? 0,
          totalAnnualDebtService: year1Projection?.totalDebtService ?? 0,
          confirmedAssumptions: {
            confirmedAt: assumptions.confirmedAt,
            revenueStreams: assumptions.revenueStreams,
            costAssumptions: assumptions.costAssumptions,
            workingCapital: assumptions.workingCapital,
            loanImpact: assumptions.loanImpact,
          },
          dscrThreshold: projectedDscrThreshold,
          projectedDscr: year1Projection?.dscr ?? 0,
          components:
            "Projected EBITDA and total annual debt service from the authoritative SBA projection model.",
        },
      );
      if (projectionsResult.status === "ready") {
        projectionsAssumptionsNarrative = projectionsResult.narrative;
      } else if (mode === "final") {
        throw new Error(`projections_review_blocked: ${projectionsResult.message}`);
      }
    }
  } catch (e) {
    if (mode === "final") throw e;
    console.warn(
      "[sbaPackageOrchestrator] projections-assumptions narrative failed (non-fatal):",
      e instanceof Error ? e.message : String(e),
    );
  }

  // Render and persist the PDF before creating the canonical package row.
  // A package without its PDF is not a successful SBA package: callers, version
  // history, and lender delivery all treat pdf_url as the durable artifact pointer.
  let pdfUrl: string | null = null;
  let pdfPath: string | null = null;
  let finalRenderInput: SBAPackageRenderInput | null = null;
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

    const previewMonthly =
      mode === "preview" ? redactMonthlyProjectionsForPreview(monthlyProjections) : monthlyProjections;
    const previewBreakEven = mode === "preview" ? redactBreakEvenForPreview(breakEven) : breakEven;
    const previewSensitivity =
      mode === "preview" ? redactSensitivityScenariosForPreview(sensitivityScenarios) : sensitivityScenarios;
    const previewRevenueStreams =
      mode === "preview" && revenueStreamProjections
        ? redactRevenueStreamProjectionsForPreview(revenueStreamProjections)
        : revenueStreamProjections;

    finalRenderInput = {
      dealName: redacted.dealName,
      loanType: redacted.loanType,
      loanAmount: redacted.loanAmount,
      dscrThreshold: projectedDscrThreshold,
      baseYear: { ...baseYear, ...redacted.baseYear },
      annualProjections: annualProjections.map((p, i) => ({
        ...p,
        revenue: redacted.annualProjections[i]?.revenue ?? p.revenue,
        ebitda: redacted.annualProjections[i]?.ebitda ?? p.ebitda,
        totalDebtService:
          redacted.annualProjections[i]?.totalDebtService ?? p.totalDebtService,
        dscr: redacted.annualProjections[i]?.dscr ?? p.dscr,
      })),
      monthlyProjections: previewMonthly,
      revenueStreamProjections: previewRevenueStreams,
      breakEven: previewBreakEven,
      sensitivityScenarios: previewSensitivity,
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
      projectionAccountingBasis: mode === "preview" ? undefined : projectionModel.accountingBasis,
      projectionsAssumptionsNarrative: mode === "preview" ? undefined : projectionsAssumptionsNarrative ?? undefined,
      globalCashFlow: mode === "preview" ? undefined : globalCashFlow,
      previewWatermark: mode === "preview",
    };

    const pdfBuffer = await renderSBAPackagePDF(finalRenderInput);
    const previewSuffix = mode === "preview" ? "_preview" : "";
    pdfPath = `sba-packages/${dealId}/${Date.now()}${previewSuffix}.pdf`;
    const { error: uploadError } = await sb.storage
      .from("deal-documents")
      .upload(pdfPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("[sbaPackageOrchestrator] PDF upload failed");
      return { ok: false, error: "SBA package PDF upload failed." };
    }
    pdfUrl = pdfPath;
  } catch (pdfErr) {
    console.error(
      "[sbaPackageOrchestrator] PDF render failed:",
      pdfErr instanceof Error ? pdfErr.message : "unknown_error",
    );
    return { ok: false, error: "SBA package PDF rendering failed." };
  }

  if (!finalRenderInput || !pdfUrl || !pdfPath) {
    return {
      ok: false,
      error: "SBA package PDF persistence could not be proven.",
    };
  }

  // Compute SBA guarantee
  const sbaProgram = detectSBAProgram(deal?.deal_type ?? null);
  const guarantee = calculateSBAGuarantee(
    assumptions.loanImpact.loanAmount,
    sbaProgram,
  );

  // Phase BPG — versioning (parent_package_id = previous latest)
  const { data: priorRows, error: priorRowsError } = await sb
    .from("buddy_sba_packages")
    .select("id, version_number")
    .eq("deal_id", dealId)
    .order("version_number", { ascending: false })
    .limit(1);
  if (priorRowsError) {
    const { error: cleanupError } = await sb.storage
      .from("deal-documents")
      .remove([pdfPath]);
    if (cleanupError) {
      console.error("[sbaPackageOrchestrator] orphan PDF cleanup failed");
    }
    return { ok: false, error: "SBA package version lookup failed." };
  }
  const priorLatest = priorRows?.[0] as
    | { id: string; version_number: number | null }
    | undefined;
  const nextVersionNumber = (priorLatest?.version_number ?? 0) + 1;
  const parentPackageId = priorLatest?.id ?? null;

  // Store package record (now with all BPG fields)
  const { data: pkg, error: packageInsertError } = await sb
    .from("buddy_sba_packages")
    .insert({
      deal_id: dealId,
      assumptions_id: assumptionsRow.id,
      financial_snapshot_id: financialSnapshot.id,
      render_input: finalRenderInput,
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
      projections_assumptions_narrative: projectionsAssumptionsNarrative,
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
    .select("id, pdf_url")
    .single();

  if (packageInsertError || !pkg?.id || pkg.pdf_url !== pdfUrl) {
    console.error("[sbaPackageOrchestrator] package row persistence failed");
    const { error: cleanupError } = await sb.storage
      .from("deal-documents")
      .remove([pdfPath]);
    if (cleanupError) {
      console.error("[sbaPackageOrchestrator] orphan PDF cleanup failed");
    }
    return { ok: false, error: "SBA package persistence failed." };
  }

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
    packageId: pkg.id,
    dscrBelowThreshold,
    dscrYear1Base,
    pdfUrl,
    versionNumber: nextVersionNumber,
    renderInput: finalRenderInput,
  };
}
