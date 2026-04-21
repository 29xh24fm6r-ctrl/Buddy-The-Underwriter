import "server-only";

// src/lib/feasibility/feasibilityEngine.ts
// Phase God Tier Feasibility — Orchestrator (step 11/16).
// Gathers all inputs from existing systems (deal metadata, borrower app,
// BIE research, SBA projections + assumptions, ownership entities,
// guarantor cashflow, NAICS benchmarks), runs the 4 dimension analyses,
// composes the score, optionally runs the franchise comparator, calls
// Gemini for narratives, renders the PDF, uploads it, and persists a
// buddy_feasibility_studies row.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractResearchForBusinessPlan } from "@/lib/sba/sbaResearchExtractor";
import { findBenchmarkByNaics } from "@/lib/sba/sbaAssumptionBenchmarks";
import { analyzeMarketDemand } from "./marketDemandAnalysis";
import { analyzeFinancialViability } from "./financialViabilityAnalysis";
import { analyzeOperationalReadiness } from "./operationalReadinessAnalysis";
import { analyzeLocationSuitability } from "./locationSuitabilityAnalysis";
import { computeCompositeFeasibility } from "./feasibilityScorer";
import { generateFeasibilityNarratives } from "./feasibilityNarrative";
import { renderFeasibilityPDF } from "./feasibilityRenderer";
import { runFranchiseComparison } from "./franchiseComparator";
import { extractBIEMarketData } from "./bieMarketExtractor";
import type {
  FeasibilityResult,
  ManagementMemberLite,
  PlannedHireLite,
  TradeAreaData,
} from "./types";

// Phase 2 Gap B — SSE callers pass an onProgress to stream step updates.
// Defaults to no-op so existing synchronous callers are unaffected.
export type FeasibilityProgressCallback = (step: string, pct: number) => void;

// Defensive shapes for jsonb columns — we never trust the DB to match
// our compile-time SBA types perfectly.
type SbaPackageRow = {
  id?: string;
  dscr_year1_base?: number | null;
  dscr_year2_base?: number | null;
  dscr_year3_base?: number | null;
  sensitivity_scenarios?: unknown;
  projections_annual?: unknown;
  break_even?: unknown;
  sources_and_uses?: unknown;
  global_dscr?: number | null;
  balance_sheet_projections?: unknown;
};

type SbaAssumptionsRow = {
  management_team?: unknown;
  cost_assumptions?: unknown;
  loan_impact?: unknown;
};

type GuarantorRow = {
  entity_id?: string;
  w2_salary?: number | null;
  other_personal_income?: number | null;
  mortgage_payment?: number | null;
  auto_payments?: number | null;
  student_loans?: number | null;
  credit_card_minimums?: number | null;
  other_personal_debt?: number | null;
};

function pickNumber(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickArray<T = Record<string, unknown>>(val: unknown): T[] {
  return Array.isArray(val) ? (val as T[]) : [];
}

function pickObject(val: unknown): Record<string, unknown> {
  return val && typeof val === "object" && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

// ─── Public entry ────────────────────────────────────────────────────────

export async function generateFeasibilityStudy(params: {
  dealId: string;
  bankId: string;
  onProgress?: FeasibilityProgressCallback;
}): Promise<FeasibilityResult> {
  const sb = supabaseAdmin();
  const { dealId, bankId } = params;
  const progress: FeasibilityProgressCallback =
    params.onProgress ?? (() => {});

  progress("Loading deal data…", 5);

  // ── 1. Deal metadata ────────────────────────────────────────────
  // Only select columns that actually exist on deals today. Franchise +
  // zip_code columns don't exist yet; we treat them as null.
  const { data: deal } = await sb
    .from("deals")
    .select("id, name, deal_type, loan_amount, city, state, bank_id, borrower_id")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return { ok: false, error: "Deal not found" };

  // ── 2. Borrower application ────────────────────────────────────
  const { data: app } = await sb
    .from("borrower_applications")
    .select("naics, industry, business_legal_name")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── 3. BIE research (never throws) ─────────────────────────────
  progress("Extracting research intelligence…", 15);
  const research = await extractResearchForBusinessPlan(dealId).catch(
    () => ({
      industryOverview: null,
      industryOutlook: null,
      competitiveLandscape: null,
      marketIntelligence: null,
      borrowerProfile: null,
      managementIntelligence: null,
      regulatoryEnvironment: null,
      creditThesis: null,
      threeToFiveYearOutlook: null,
    }),
  );

  // ── 3b. BIE structured market data (Phase 2 Gap A) ─────────────
  // Pulls numeric claims + trend direction + risk signals out of the BIE
  // research claim graph so market demand and location suitability get
  // data-driven scores instead of neutral defaults.
  const bieMarket = await extractBIEMarketData(dealId).catch(() => null);

  // ── 4. SBA package (latest version) ────────────────────────────
  const { data: sbaPackageRaw } = await sb
    .from("buddy_sba_packages")
    .select("*")
    .eq("deal_id", dealId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sbaPackage = (sbaPackageRaw ?? null) as SbaPackageRow | null;

  // ── 5. SBA assumptions (latest confirmed) ──────────────────────
  const { data: assumptionsRaw } = await sb
    .from("buddy_sba_assumptions")
    .select("*")
    .eq("deal_id", dealId)
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const assumptions = (assumptionsRaw ?? null) as SbaAssumptionsRow | null;

  // ── 6. NAICS benchmark ─────────────────────────────────────────
  const naicsCode = (app?.naics ?? null) as string | null;
  const benchmark = findBenchmarkByNaics(naicsCode);

  // ── 7. Ownership entities (fallback management team) ───────────
  const { data: owners } = await sb
    .from("deal_ownership_entities")
    .select("id, display_name, entity_type")
    .eq("deal_id", dealId);

  // ── 8. Guarantor cashflow ──────────────────────────────────────
  const { data: guarantorCFraw } = await sb
    .from("buddy_guarantor_cashflow")
    .select(
      "entity_id, w2_salary, other_personal_income, mortgage_payment, auto_payments, student_loans, credit_card_minimums, other_personal_debt",
    )
    .eq("deal_id", dealId);
  const guarantorCF = (guarantorCFraw ?? []) as GuarantorRow[];

  // ── 9. Franchise detection (v1: always false) ──────────────────
  const isFranchise = false;

  // ── 10. Trade area data from BIE (Phase 2 Gap A) ───────────────
  // In v1 this was always null; in v2 we use the BIE-extracted numeric
  // claims so market demand + location suitability can score against real
  // demographics, competitor counts, and trend signals.
  const tradeArea: TradeAreaData | null = bieMarket
    ? {
        populationRadius5mi: bieMarket.populationMentioned,
        populationRadius10mi: null,
        medianHouseholdIncome: bieMarket.medianIncomeMentioned,
        populationGrowthRate5yr: null,
        competitorCount: bieMarket.competitorCountMentioned,
        totalBusinesses: null,
      }
    : null;

  // ── 11. Run all 4 dimension analyses ───────────────────────────
  progress("Analyzing market demand…", 25);

  const projAnnual = pickArray<{ revenue?: number | null }>(
    sbaPackage?.projections_annual,
  );
  const projY1 = projAnnual[0] ?? null;

  const sensScenarios = pickArray<{
    name?: string;
    scenario?: string;
    dscrYear1?: number;
    dscr_year1?: number;
  }>(sbaPackage?.sensitivity_scenarios);
  const downside = sensScenarios.find(
    (s) =>
      (s.name ?? "").toLowerCase() === "downside" ||
      (s.scenario ?? "").toLowerCase() === "downside",
  );
  const downsideDscrY1 = downside
    ? pickNumber(downside.dscrYear1 ?? downside.dscr_year1)
    : null;

  const breakEvenObj = pickObject(sbaPackage?.break_even);
  const sourcesAndUsesObj = pickObject(sbaPackage?.sources_and_uses);
  const balanceSheet = pickArray<{
    currentRatio?: number;
    debtToEquity?: number;
  }>(sbaPackage?.balance_sheet_projections);

  const marketDemand = analyzeMarketDemand({
    city: deal.city,
    state: deal.state,
    zipCode: null,
    naicsCode,
    naicsDescription: app?.industry ?? null,
    projectedAnnualRevenue: pickNumber(projY1?.revenue),
    research: {
      marketIntelligence: research.marketIntelligence,
      competitiveLandscape: research.competitiveLandscape,
      industryOverview: research.industryOverview,
      demographicTrends: null,
    },
    franchise: null,
    benchmark,
    tradeArea,
  });

  // Management team — prefer confirmed SBA assumptions, else fall back to
  // deal ownership entities with blank experience/bios.
  const teamFromAssumptions = pickArray<Record<string, unknown>>(
    assumptions?.management_team,
  );
  const managementTeam: ManagementMemberLite[] =
    teamFromAssumptions.length > 0
      ? teamFromAssumptions.map((m) => ({
          name: String(m.name ?? ""),
          title: String(m.title ?? "Owner"),
          ownershipPct: pickNumber(m.ownershipPct) ?? 0,
          yearsInIndustry: pickNumber(m.yearsInIndustry) ?? 0,
          bio: String(m.bio ?? ""),
        }))
      : (owners ?? [])
          .filter(
            (o: { entity_type: string | null }) =>
              (o.entity_type ?? "").toLowerCase() === "individual",
          )
          .map((o: { display_name: string | null }) => ({
            name: o.display_name ?? "",
            title: "Owner",
            ownershipPct: 0,
            yearsInIndustry: 0,
            bio: "",
          }));

  const plannedHires = pickArray<Record<string, unknown>>(
    pickObject(assumptions?.cost_assumptions).plannedHires,
  ).map<PlannedHireLite>((h) => ({
    role: String(h.role ?? ""),
    startMonth: pickNumber(h.startMonth) ?? 1,
    annualSalary: pickNumber(h.annualSalary) ?? 0,
  }));

  const loanImpactObj = pickObject(assumptions?.loan_impact);

  progress("Evaluating financial viability…", 35);
  const financialViability = analyzeFinancialViability({
    dscrYear1Base: pickNumber(sbaPackage?.dscr_year1_base),
    dscrYear2Base: pickNumber(sbaPackage?.dscr_year2_base),
    dscrYear3Base: pickNumber(sbaPackage?.dscr_year3_base),
    dscrYear1Downside: downsideDscrY1,
    breakEvenRevenue: pickNumber(breakEvenObj.breakEvenRevenue),
    projectedRevenueYear1: pickNumber(projY1?.revenue),
    marginOfSafetyPct: pickNumber(breakEvenObj.marginOfSafetyPct),
    downsideDscrYear1: downsideDscrY1,
    equityInjectionPct: pickNumber(sourcesAndUsesObj.equityInjectionPct),
    totalProjectCost: pickNumber(sourcesAndUsesObj.totalUses),
    workingCapitalReserveMonths: null,
    globalDscr: pickNumber(sbaPackage?.global_dscr),
    guarantorsWithNegativeCF: guarantorCF
      .filter((g) => {
        const income = (g.w2_salary ?? 0) + (g.other_personal_income ?? 0);
        const obligations =
          (g.mortgage_payment ?? 0) +
          (g.auto_payments ?? 0) +
          (g.student_loans ?? 0) +
          (g.credit_card_minimums ?? 0) +
          (g.other_personal_debt ?? 0);
        return income - obligations < 0;
      })
      .map((g) => g.entity_id ?? "")
      .filter((id) => id.length > 0),
    currentRatioYear1: pickNumber(balanceSheet[1]?.currentRatio),
    debtToEquityYear1: pickNumber(balanceSheet[1]?.debtToEquity),
    historicalRevenueGrowth: null,
    historicalEBITDAMargin: null,
    isNewBusiness: false, // conservative default; upgrade when years_in_business is tracked
    loanAmount: pickNumber(loanImpactObj.loanAmount) ?? 0,
    loanTermMonths:
      (pickNumber(loanImpactObj.termMonths) ??
        (pickNumber(loanImpactObj.loanTermYears) ?? 10) * 12) || 120,
  });

  progress("Assessing operational readiness…", 45);
  const operationalReadiness = analyzeOperationalReadiness({
    managementTeam,
    plannedHires,
    managementIntelligence: research.managementIntelligence,
    managementValidated: false,
    isFranchise,
    franchiseTrainingWeeks: null,
    franchiseOngoingSupport: null,
    franchiseOperationsManual: null,
  });

  const locationSuitability = analyzeLocationSuitability({
    city: deal.city,
    state: deal.state,
    zipCode: null,
    research: {
      marketIntelligence: research.marketIntelligence,
      areaSpecificRisks: bieMarket?.areaSpecificRisksText ?? null,
      realEstateMarket: bieMarket?.realEstateMarketText ?? null,
      trendDirection: bieMarket?.trendDirection ?? null,
    },
    tradeArea: tradeArea
      ? {
          unemploymentRate: bieMarket?.unemploymentRateMentioned ?? null,
          medianHouseholdIncome: tradeArea.medianHouseholdIncome,
          populationGrowthRate5yr: null,
          commercialVacancyRate: null,
          medianRentPsf: null,
        }
      : null,
    property: null,
  });

  // ── 12. Composite score ────────────────────────────────────────

  progress("Computing composite feasibility score…", 55);
  const composite = computeCompositeFeasibility({
    marketDemand,
    financialViability,
    operationalReadiness,
    locationSuitability,
    isFranchise,
  });

  // ── 13. Franchise comparison (always null in v1) ──────────────

  const franchiseComparison = isFranchise
    ? await runFranchiseComparison({
        proposedBrandId: null,
        proposedBrandName: null,
        naicsCode,
        borrowerEquity: 0,
        borrowerExperienceYears: Math.max(
          0,
          ...managementTeam.map((m) => m.yearsInIndustry),
        ),
        tradeAreaPopulation: null,
        tradeAreaMedianIncome: null,
      })
    : null;

  // ── 14. Narratives ─────────────────────────────────────────────

  progress("Writing consultant narratives…", 65);
  const narratives = await generateFeasibilityNarratives({
    dealName: deal.name ?? "Borrower",
    city: deal.city,
    state: deal.state,
    composite,
    marketDemand,
    financialViability,
    operationalReadiness,
    locationSuitability,
    franchiseComparison,
    research,
    isFranchise,
    brandName: null,
    managementTeam,
  });

  // ── 15. Render PDF + upload to storage ─────────────────────────

  progress("Rendering feasibility report…", 85);
  let pdfUrl: string | null = null;
  try {
    const pdfBuffer = await renderFeasibilityPDF({
      dealName: deal.name ?? "Borrower",
      city: deal.city,
      state: deal.state,
      composite,
      marketDemand,
      financialViability,
      operationalReadiness,
      locationSuitability,
      narratives,
      franchiseComparison,
      isFranchise,
      brandName: null,
      generatedAt: new Date().toISOString(),
    });

    const pdfPath = `feasibility-studies/${dealId}/${Date.now()}.pdf`;
    const { error: upErr } = await sb.storage
      .from("deal-documents")
      .upload(pdfPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (!upErr) {
      pdfUrl = pdfPath;
    } else {
      console.error("[feasibilityEngine] PDF upload error:", upErr);
    }
  } catch (err) {
    console.error("[feasibilityEngine] PDF render error:", err);
  }

  // ── 16. Determine next version_number & persist ───────────────

  progress("Saving results…", 95);
  const { data: latest } = await sb
    .from("buddy_feasibility_studies")
    .select("version_number")
    .eq("deal_id", dealId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((latest as { version_number?: number } | null)
    ?.version_number ?? 0) + 1;

  const { data: study, error: insErr } = await sb
    .from("buddy_feasibility_studies")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      composite_score: composite.overallScore,
      recommendation: composite.recommendation,
      confidence_level: composite.confidenceLevel,
      market_demand_score: marketDemand.overallScore,
      financial_viability_score: financialViability.overallScore,
      operational_readiness_score: operationalReadiness.overallScore,
      location_suitability_score: locationSuitability.overallScore,
      market_demand_detail: marketDemand,
      financial_viability_detail: financialViability,
      operational_readiness_detail: operationalReadiness,
      location_suitability_detail: locationSuitability,
      narratives,
      franchise_comparison: franchiseComparison,
      flags: composite.allFlags,
      data_completeness: composite.overallDataCompleteness,
      pdf_url: pdfUrl,
      projections_package_id: (sbaPackage?.id as string | undefined) ?? null,
      is_franchise: isFranchise,
      status: "completed",
      version_number: nextVersion,
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    console.error(
      "[feasibilityEngine] insert error:",
      insErr.code,
      insErr.message,
      insErr.details,
    );
    return { ok: false, error: "Failed to persist study" };
  }

  progress("Complete!", 100);
  return {
    ok: true,
    studyId: (study as { id?: string } | null)?.id,
    composite,
    pdfUrl: pdfUrl ?? undefined,
  };
}
