import "server-only";

/**
 * Phase 7R Pass 2 — SBA Namespace Anchor (in-place consolidation)
 *
 * Consolidates 18 of 22 prior /api/deals/[dealId]/sba/* routes into one
 * action-dispatch handler. Routes NOT consolidated (per Matt 2026-04-28):
 *   - /api/deals/[dealId]/sba/submit       — kept on its own file
 *   - /api/deals/[dealId]/sba/etran-readiness — kept on its own file
 *   - /api/deals/[dealId]/sba/forms/[formId] — separate parameterized file
 *
 * GET ?view=<view>  — read state (or shape variants)
 * POST { action, ... } — mutations + compute + generate + lifecycle
 *
 * All engines preserved — this file is HTTP dispatch only. Auth gates
 * remain route-handler-owned (per non-negotiable #9).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  evaluateSBAEligibility,
  formatEligibilityReport,
  type SBAProgram,
} from "@/lib/sba/eligibility";
import { calculateDifficultyScore, formatDifficultyScore } from "@/lib/sba/difficulty";
import { draftAssumptionsFromContext } from "@/lib/sba/sbaAssumptionDrafter";
import { loadSBAAssumptionsPrefill } from "@/lib/sba/sbaAssumptionsPrefill";
import { generateSBAPackage } from "@/lib/sba/sbaPackageOrchestrator";
import { callGeminiJSON } from "@/lib/sba/sbaPackageNarrative";
import { extractResearchForBusinessPlan } from "@/lib/sba/sbaResearchExtractor";
import { buildSBARiskProfile } from "@/lib/sba/sbaRiskProfile";
import type { UrbanRuralClassification } from "@/lib/sba/sbaRiskProfile";
import {
  loadBorrowerStory,
  saveBorrowerStory,
  type BorrowerStory,
  type VoiceFormality,
  type CapturedVia,
} from "@/lib/sba/sbaBorrowerStory";
import { prepareSbaPackage } from "@/lib/sba/package/buildPackage";
import { generatePdfForFillRun } from "@/lib/forms/pdfFill/generatePdfForFillRun";
import { ensureSbaLoanAndMilestones } from "@/lib/sba/servicing/seedMilestones";
import { recomputeSbaServicing } from "@/lib/sba/servicing/evaluateServicing";

export const runtime = "nodejs";
export const maxDuration = 120; // generate-package action is long-running
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

const SBA_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"];

// ─── Helpers ─────────────────────────────────────────────────────────────

async function ensureSbaDealOrReturn403(
  dealId: string,
): Promise<Response | null> {
  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("deal_type")
    .eq("id", dealId)
    .single();
  if (!deal || !SBA_TYPES.includes(deal.deal_type ?? "")) {
    return NextResponse.json(
      { error: "SBA Package is not available for this deal type." },
      { status: 403 },
    );
  }
  return null;
}

const EDITABLE_NARRATIVE_FIELDS = new Set<string>([
  "executive_summary",
  "industry_analysis",
  "marketing_strategy",
  "operations_plan",
  "swot_strengths",
  "swot_weaknesses",
  "swot_opportunities",
  "swot_threats",
  "sensitivity_narrative",
  "business_overview_narrative",
  "franchise_section",
]);

const SECTION_COLUMNS: Record<string, string> = {
  executive_summary: "executive_summary",
  industry_analysis: "industry_analysis",
  marketing_strategy: "marketing_strategy",
  operations_plan: "operations_plan",
  swot_strengths: "swot_strengths",
  swot_weaknesses: "swot_weaknesses",
  swot_opportunities: "swot_opportunities",
  swot_threats: "swot_threats",
  business_overview_narrative: "business_overview_narrative",
  sensitivity_narrative: "sensitivity_narrative",
  franchise_section: "franchise_section",
};

const SECTION_LABELS: Record<string, string> = {
  executive_summary: "Executive Summary",
  industry_analysis: "Industry Analysis",
  marketing_strategy: "Marketing Strategy",
  operations_plan: "Operations Plan",
  swot_strengths: "SWOT — Strengths",
  swot_weaknesses: "SWOT — Weaknesses",
  swot_opportunities: "SWOT — Opportunities",
  swot_threats: "SWOT — Threats",
  business_overview_narrative: "Business Overview",
  sensitivity_narrative: "Sensitivity Analysis Narrative",
  franchise_section: "Franchise Section",
};

// borrower-story input coercion helpers
function asTrimmedStringOrNull(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function asVoiceFormality(value: unknown): VoiceFormality | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value === "casual" || value === "professional" || value === "technical") {
    return value;
  }
  return undefined;
}
function asCapturedVia(value: unknown): CapturedVia | undefined {
  if (value === "voice" || value === "chat" || value === "form") return value;
  return undefined;
}
function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

// generate-package streaming milestones
const MILESTONES: Array<{ step: string; pct: number; delayMs: number }> = [
  { step: "Loading financial data...", pct: 5, delayMs: 0 },
  { step: "Building financial projections...", pct: 15, delayMs: 2500 },
  { step: "Computing break-even analysis...", pct: 25, delayMs: 5000 },
  { step: "Building Sources & Uses...", pct: 30, delayMs: 7500 },
  { step: "Writing Executive Summary...", pct: 40, delayMs: 10000 },
  { step: "Writing Industry Analysis...", pct: 50, delayMs: 15000 },
  { step: "Writing Marketing Strategy...", pct: 55, delayMs: 20000 },
  { step: "Writing SWOT Analysis...", pct: 60, delayMs: 25000 },
  { step: "Rendering PDF...", pct: 80, delayMs: 40000 },
  { step: "Cross-filling SBA forms...", pct: 90, delayMs: 55000 },
];

// ─── GET — view dispatch ──────────────────────────────────────────────────

export async function GET(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const url = new URL(req.url);
    const view = url.searchParams.get("view") ?? "assumptions";

    switch (view) {
      case "assumptions":
        return getAssumptions(dealId);
      case "borrower-story":
        return getBorrowerStory(dealId);
      case "guarantor-cashflow":
        return getGuarantorCashflow(dealId);
      case "risk-profile":
        return getRiskProfile(dealId, access.bankId);
      case "latest":
        return getLatestPackage(dealId);
      case "versions":
        return getVersions(dealId);
      case "diff": {
        const v1 = url.searchParams.get("v1");
        const v2 = url.searchParams.get("v2");
        return getDiff(dealId, v1, v2);
      }
      case "review":
        return getReview(dealId);
      case "servicing":
        return getServicing(dealId);
      case "run-items": {
        const runId = url.searchParams.get("runId");
        if (!runId) {
          return NextResponse.json(
            { ok: false, error: "runId query param required for view=run-items" },
            { status: 400 },
          );
        }
        return getRunItems(runId);
      }
      default:
        return NextResponse.json(
          { ok: false, error: `Unknown view: ${view}` },
          { status: 400 },
        );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ─── POST — action dispatch ───────────────────────────────────────────────

export async function POST(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = (body as { action?: string }).action;

    if (!action) {
      return NextResponse.json(
        { ok: false, error: "action required in body" },
        { status: 400 },
      );
    }

    switch (action) {
      // Compute
      case "evaluate-eligibility":
        return evaluateEligibilityAction(dealId, body);
      case "evaluate-difficulty":
        return evaluateDifficultyAction(dealId, body);

      // AI generation
      case "draft-assumptions":
        return draftAssumptionsAction(dealId);
      case "generate-package":
        return generatePackageAction(dealId); // streaming
      case "chat-refine":
        return chatRefineAction(dealId, body);
      case "refine-section":
        return refineSectionAction(dealId, body);

      // State mutations (using POST as catch-all action verb)
      case "patch-assumptions":
        return patchAssumptionsAction(dealId, body);
      case "update-borrower-story":
        return updateBorrowerStoryAction(dealId, body);
      case "update-guarantor-cashflow":
        return updateGuarantorCashflowAction(dealId, body);

      // Review lifecycle
      case "review-approve":
      case "review-request-changes":
      case "review-submit":
        return reviewLifecycleAction(dealId, action, body);
      case "inline-edit-narrative":
        return inlineEditNarrativeAction(dealId, body);

      // Package run lifecycle
      case "prepare-package-run":
        return preparePackageRunAction(dealId, body);
      case "generate-package-run-pdf":
        return generatePackageRunPdfAction(dealId, body);

      // Servicing
      case "recompute-servicing":
        return recomputeServicingAction(dealId, body);

      default:
        return NextResponse.json(
          { ok: false, error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ─── GET handlers ─────────────────────────────────────────────────────────

async function getAssumptions(dealId: string): Promise<Response> {
  const sbaGate = await ensureSbaDealOrReturn403(dealId);
  if (sbaGate) return sbaGate;

  const sb = supabaseAdmin();
  const { data: assumptionsRow } = await sb
    .from("buddy_sba_assumptions")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  const prefillRaw = await loadSBAAssumptionsPrefill(dealId);
  const { _prefillMeta, ...prefilled } = prefillRaw;

  const assumptions = assumptionsRow
    ? {
        dealId,
        status: assumptionsRow.status,
        confirmedAt: assumptionsRow.confirmed_at ?? undefined,
        revenueStreams: assumptionsRow.revenue_streams,
        costAssumptions: assumptionsRow.cost_assumptions,
        workingCapital: assumptionsRow.working_capital,
        loanImpact: assumptionsRow.loan_impact,
        managementTeam: assumptionsRow.management_team,
      }
    : null;

  return NextResponse.json({
    assumptions,
    prefilled,
    prefillMeta: _prefillMeta ?? null,
  });
}

async function getBorrowerStory(dealId: string): Promise<Response> {
  const story = await loadBorrowerStory(dealId);
  return NextResponse.json({ ok: true, story });
}

async function getGuarantorCashflow(dealId: string): Promise<Response> {
  const sb = supabaseAdmin();

  const [{ data: entities }, { data: interests }, { data: cashflows }] =
    await Promise.all([
      sb
        .from("deal_ownership_entities")
        .select("id, display_name, entity_type")
        .eq("deal_id", dealId),
      sb
        .from("deal_ownership_interests")
        .select("owner_entity_id, ownership_pct")
        .eq("deal_id", dealId),
      sb
        .from("buddy_guarantor_cashflow")
        .select("*")
        .eq("deal_id", dealId),
    ]);

  const rows = (entities ?? [])
    .map((e: { id: string; display_name: string | null; entity_type: string | null }) => {
      const interest = (interests ?? []).find(
        (i: { owner_entity_id: string; ownership_pct: number | null }) =>
          i.owner_entity_id === e.id,
      );
      const ownershipPct = Number(interest?.ownership_pct ?? 0);
      const cf = (cashflows ?? []).find(
        (c: { entity_id: string }) => c.entity_id === e.id,
      );
      return {
        entity_id: e.id,
        display_name: e.display_name,
        entity_type: e.entity_type,
        ownership_pct: ownershipPct,
        w2_salary: Number(cf?.w2_salary ?? 0),
        other_personal_income: Number(cf?.other_personal_income ?? 0),
        personal_income_notes: cf?.personal_income_notes ?? "",
        mortgage_payment: Number(cf?.mortgage_payment ?? 0),
        auto_payments: Number(cf?.auto_payments ?? 0),
        student_loans: Number(cf?.student_loans ?? 0),
        credit_card_minimums: Number(cf?.credit_card_minimums ?? 0),
        other_personal_debt: Number(cf?.other_personal_debt ?? 0),
        personal_debt_notes: cf?.personal_debt_notes ?? "",
      };
    })
    .filter((r) => r.ownership_pct >= 20);

  return NextResponse.json({ ok: true, guarantors: rows });
}

async function getRiskProfile(dealId: string, bankId: string): Promise<Response> {
  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("id, name, deal_type, loan_amount")
    .eq("id", dealId)
    .single();

  if (!deal || !SBA_TYPES.includes(deal.deal_type ?? "")) {
    return NextResponse.json(
      { error: "SBA risk profile is only available for SBA loan types." },
      { status: 403 },
    );
  }

  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, value_numeric, value_text")
    .eq("deal_id", dealId)
    .in("fact_key", [
      "YEARS_IN_BUSINESS",
      "MONTHS_IN_BUSINESS",
      "BUSINESS_DATE_FORMED",
      "DATE_FORMED",
      "NAICS_CODE",
    ]);

  const { data: businessSection } = await sb
    .from("deal_builder_sections")
    .select("data")
    .eq("deal_id", dealId)
    .eq("section_key", "business")
    .maybeSingle();

  const { data: structureSection } = await sb
    .from("deal_builder_sections")
    .select("data")
    .eq("deal_id", dealId)
    .eq("section_key", "structure")
    .maybeSingle();

  const { data: assumptionsRow } = await sb
    .from("buddy_sba_assumptions")
    .select("management_team")
    .eq("deal_id", dealId)
    .maybeSingle();

  const business = ((businessSection?.data as Record<string, unknown>) ?? {});
  const structure = ((structureSection?.data as Record<string, unknown>) ?? {});

  const naicsFromFact = (facts ?? []).find((f) => f.fact_key === "NAICS_CODE")?.value_text;
  const naicsCode = naicsFromFact ?? (business.naics_code as string | null) ?? null;
  const termMonths =
    (structure.desired_term_months as number | null) ??
    (structure.term_months as number | null) ??
    null;

  const managementTeam =
    (assumptionsRow?.management_team as Array<{ yearsInIndustry?: number }> | null) ?? [];
  const managementYearsInIndustry =
    managementTeam.length > 0
      ? Math.max(...managementTeam.map((m) => m.yearsInIndustry ?? 0))
      : null;

  const profile = await buildSBARiskProfile({
    dealId,
    loanType: deal.deal_type ?? "SBA",
    naicsCode,
    termMonths,
    urbanRural: "unknown" as UrbanRuralClassification,
    state: (business.state as string | null) ?? null,
    zip: (business.zip as string | null) ?? null,
    facts: facts ?? [],
    managementYearsInIndustry,
    hasBusinessPlan: !!assumptionsRow?.management_team,
    sb,
  });

  return NextResponse.json({ profile });
}

async function getLatestPackage(dealId: string): Promise<Response> {
  const sbaGate = await ensureSbaDealOrReturn403(dealId);
  if (sbaGate) return sbaGate;

  const sb = supabaseAdmin();
  const { data: row } = await sb
    .from("buddy_sba_packages")
    .select("*")
    .eq("deal_id", dealId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ package: null });
  }

  return NextResponse.json({
    package: {
      id: row.id,
      dealId: row.deal_id,
      assumptionsId: row.assumptions_id,
      generatedAt: row.generated_at,
      baseYearData: row.base_year_data,
      projectionsAnnual: row.projections_annual,
      projectionsMonthly: row.projections_monthly,
      breakEven: row.break_even,
      sensitivityScenarios: row.sensitivity_scenarios,
      useOfProceeds: row.use_of_proceeds,
      dscrYear1Base: row.dscr_year1_base,
      dscrYear2Base: row.dscr_year2_base,
      dscrYear3Base: row.dscr_year3_base,
      dscrYear1Downside: row.dscr_year1_downside,
      dscrBelowThreshold: row.dscr_below_threshold,
      businessOverviewNarrative: row.business_overview_narrative,
      sensitivityNarrative: row.sensitivity_narrative,
      executiveSummary: row.executive_summary,
      industryAnalysis: row.industry_analysis,
      marketingStrategy: row.marketing_strategy,
      operationsPlan: row.operations_plan,
      swotStrengths: row.swot_strengths,
      swotWeaknesses: row.swot_weaknesses,
      swotOpportunities: row.swot_opportunities,
      swotThreats: row.swot_threats,
      franchiseSection: row.franchise_section,
      pdfUrl: row.pdf_url,
      status: row.status,
    },
  });
}

async function getVersions(dealId: string): Promise<Response> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("buddy_sba_packages")
    .select(
      "id, version_number, created_at, status, dscr_year1_base, dscr_below_threshold, break_even_revenue, margin_of_safety_pct",
    )
    .eq("deal_id", dealId)
    .order("version_number", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, versions: data ?? [] });
}

interface DiffPkg {
  id: string;
  version_number: number;
  created_at: string;
  dscr_year1_base: number | null;
  dscr_year2_base: number | null;
  dscr_year3_base: number | null;
  break_even_revenue: number | null;
  margin_of_safety_pct: number | null;
  projections_annual: Array<{ revenue: number }> | null;
}

const DIFF_FIELDS: Array<keyof DiffPkg | "revenue_year1"> = [
  "dscr_year1_base",
  "dscr_year2_base",
  "dscr_year3_base",
  "break_even_revenue",
  "margin_of_safety_pct",
  "revenue_year1",
];

function selectDiffField(pkg: DiffPkg, field: string): number | null {
  if (field === "revenue_year1") {
    const first = pkg.projections_annual?.[0]?.revenue;
    return typeof first === "number" ? first : null;
  }
  const value = (pkg as unknown as Record<string, unknown>)[field];
  return typeof value === "number" ? value : null;
}

async function getDiff(
  dealId: string,
  v1Id: string | null,
  v2Id: string | null,
): Promise<Response> {
  if (!v1Id || !v2Id) {
    return NextResponse.json(
      { ok: false, error: "v1 and v2 query params are required" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("buddy_sba_packages")
    .select(
      "id, version_number, created_at, deal_id, dscr_year1_base, dscr_year2_base, dscr_year3_base, break_even_revenue, margin_of_safety_pct, projections_annual",
    )
    .in("id", [v1Id, v2Id])
    .eq("deal_id", dealId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const v1 = (data ?? []).find((p) => p.id === v1Id) as DiffPkg | undefined;
  const v2 = (data ?? []).find((p) => p.id === v2Id) as DiffPkg | undefined;

  if (!v1 || !v2) {
    return NextResponse.json(
      { ok: false, error: "One or both package IDs not found for this deal" },
      { status: 404 },
    );
  }

  const changes = DIFF_FIELDS.map((field) => {
    const v1Value = selectDiffField(v1, field as string);
    const v2Value = selectDiffField(v2, field as string);
    const delta = v1Value !== null && v2Value !== null ? v2Value - v1Value : null;
    return { field, v1Value, v2Value, delta };
  });

  return NextResponse.json({ ok: true, v1, v2, changes });
}

async function getReview(dealId: string): Promise<Response> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("buddy_sba_packages")
    .select("*")
    .eq("deal_id", dealId)
    .order("version_number", { ascending: false, nullsFirst: false })
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "No SBA package generated for this deal yet." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, package: data });
}

async function getServicing(dealId: string): Promise<Response> {
  const sb = supabaseAdmin();
  const { data: loan, error: e1 } = (await sb
    .from("sba_loans")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle()) as { data: { id: string } | null; error: unknown };
  if (e1) throw e1;

  if (!loan) {
    return NextResponse.json({
      ok: true,
      loan: null,
      milestones: [],
      summary: null,
    });
  }

  const { data: milestones, error: e2 } = (await sb
    .from("sba_milestones")
    .select("*")
    .eq("sba_loan_id", loan.id)
    .order("due_date", { ascending: true })) as { data: Array<{ status: string }> | null; error: unknown };
  if (e2) throw e2;

  const summary = {
    open: (milestones ?? []).filter((m) => m.status === "OPEN").length,
    overdue: (milestones ?? []).filter((m) => m.status === "OVERDUE").length,
    completed: (milestones ?? []).filter((m) => m.status === "COMPLETED").length,
  };

  return NextResponse.json({
    ok: true,
    loan,
    milestones: milestones ?? [],
    summary,
  });
}

async function getRunItems(packageRunId: string): Promise<Response> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("sba_package_run_items")
    .select(
      "id,template_code,title,sort_order,required,status,fill_run_id,output_storage_path,output_file_name,error,updated_at",
    )
    .eq("package_run_id", packageRunId)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, items: data ?? [] });
}

// ─── POST action handlers ─────────────────────────────────────────────────

async function evaluateEligibilityAction(
  dealId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const program = ((body.program as string) ?? "7A") as SBAProgram;
  const dealData = body.dealData;

  if (!dealData) {
    return NextResponse.json(
      { ok: false, error: "Missing 'dealData'" },
      { status: 400 },
    );
  }

  const report = await evaluateSBAEligibility({ dealId, program, dealData });
  const formatted = formatEligibilityReport(report);

  return NextResponse.json({
    ok: true,
    overall_eligible: report.overall_eligible,
    hard_stops: report.hard_stops.length,
    mitigations_required: report.mitigations_required.length,
    advisories: report.advisories.length,
    passed_rules: report.passed_rules.length,
    report: formatted,
    details: report,
  });
}

async function evaluateDifficultyAction(
  dealId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const program = ((body.program as string) ?? "7A") as "7A" | "504";
  const dealData = body.dealData;

  if (!dealData) {
    return NextResponse.json(
      { ok: false, error: "Missing 'dealData'" },
      { status: 400 },
    );
  }

  const score = await calculateDifficultyScore({ dealId, program, dealData });
  const formatted = formatDifficultyScore(score);

  return NextResponse.json({
    ok: true,
    readiness_percentage: score.readiness_percentage,
    difficulty_score: score.difficulty_score,
    hard_stops: score.hard_stops,
    estimated_time: score.estimated_time_to_ready,
    top_fixes: score.top_fixes,
    formatted,
    details: score,
  });
}

async function draftAssumptionsAction(dealId: string): Promise<Response> {
  const drafted = await draftAssumptionsFromContext(dealId);

  let prefillMeta: unknown = null;
  try {
    const prefill = await loadSBAAssumptionsPrefill(dealId);
    prefillMeta = prefill._prefillMeta ?? null;
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    ok: true,
    assumptions: drafted.assumptions,
    reasoning: drafted.reasoning,
    prefillMeta,
  });
}

async function generatePackageAction(dealId: string): Promise<Response> {
  // SBA-type gate before creating the stream (matches original /sba/generate behavior)
  const sbaGate = await ensureSbaDealOrReturn403(dealId);
  if (sbaGate) return sbaGate;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* controller may be closed; ignore */
        }
      };

      const timers: ReturnType<typeof setTimeout>[] = [];
      let lastMilestonePct = 0;
      for (const m of MILESTONES) {
        const t = setTimeout(() => {
          lastMilestonePct = m.pct;
          send({ step: m.step, pct: m.pct });
        }, m.delayMs);
        timers.push(t);
      }
      const ticker = setInterval(() => {
        if (lastMilestonePct < 95) {
          lastMilestonePct = Math.min(95, lastMilestonePct + 1);
          send({ step: "Generating...", pct: lastMilestonePct });
        }
      }, 3000);

      try {
        const result = await generateSBAPackage(dealId);
        for (const t of timers) clearTimeout(t);
        clearInterval(ticker);

        if (!result.ok) {
          send({ step: "error", pct: 0, error: result.error });
          controller.close();
          return;
        }

        send({
          step: "complete",
          pct: 100,
          result: {
            ok: true,
            packageId: result.packageId,
            dscrBelowThreshold: result.dscrBelowThreshold,
            dscrYear1Base: result.dscrYear1Base,
            pdfUrl: result.pdfUrl,
            versionNumber: result.versionNumber,
          },
        });
        controller.close();
      } catch (err) {
        for (const t of timers) clearTimeout(t);
        clearInterval(ticker);
        send({
          step: "error",
          pct: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function chatRefineAction(
  dealId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const MAX_HISTORY = 10;

  const message = typeof body.message === "string" ? (body.message as string).trim() : "";
  if (!message) {
    return NextResponse.json(
      { ok: false, error: "Message is required" },
      { status: 400 },
    );
  }

  const currentAssumptions = body.currentAssumptions ?? null;
  const rawHistory = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];
  const history = (rawHistory as unknown[])
    .slice(-MAX_HISTORY)
    .filter(
      (h): h is { role: string; content: string } =>
        typeof h === "object" &&
        h !== null &&
        typeof (h as { role?: unknown }).role === "string" &&
        typeof (h as { content?: unknown }).content === "string",
    );

  const historyBlock = history.length
    ? history
        .map(
          (h) =>
            `${h.role === "buddy" ? "Buddy" : h.role === "user" ? "Borrower" : h.role}: ${h.content}`,
        )
        .join("\n")
    : "(no prior messages)";

  const prompt = `You are Buddy, an expert SBA business plan consultant. The borrower is refining their business plan assumptions through a conversational interface. Extract any specific changes from their message and return both a warm, professional conversational reply AND structured JSON patches to apply to their assumptions.

Rules:
- Be warm and professional. Explain WHY you're making each change, concisely.
- Do NOT invent market statistics or use superlatives.
- If the user is asking a question (not making a change), reply without producing patches.
- Patches use dotted paths that match the SBAAssumptions type exactly, e.g. "revenueStreams[0].growthRateYear1", "costAssumptions.cogsPercentYear1", "workingCapital.targetDSO", "loanImpact.interestRate", "loanImpact.equityInjectionAmount", "managementTeam[0].bio". Numeric values should be numbers (decimals for percentages, e.g. 0.2 for 20%). Do not invent array indices that don't already exist.
- "sectionConfirmed" should be set to one of "revenue", "costs", "workingCapital", "loan", "management" ONLY when the borrower explicitly approves that section in the current message (e.g. "looks good", "keep that"). Otherwise null.

=== CURRENT ASSUMPTIONS (JSON) ===
${JSON.stringify(currentAssumptions, null, 2)}

=== CONVERSATION HISTORY (oldest → newest) ===
${historyBlock}

=== BORROWER'S NEW MESSAGE ===
${message}

=== RESPONSE FORMAT ===
Return ONLY valid JSON:
{
  "reply": "<your conversational response, 1-3 sentences>",
  "patches": [{"path": "revenueStreams[0].growthRateYear1", "value": 0.2}, ...],
  "sectionConfirmed": "revenue" | "costs" | "workingCapital" | "loan" | "management" | null
}`;

  let parsed: { reply?: string; patches?: unknown; sectionConfirmed?: unknown };
  try {
    const raw = await callGeminiJSON(prompt);
    let stripped = raw.trim();
    if (stripped.startsWith("```")) {
      stripped = stripped.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
    }
    parsed = JSON.parse(stripped);
  } catch (err) {
    console.error("[sba/chat-refine] Gemini call failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not process that message. Please try again." },
      { status: 502 },
    );
  }

  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim().length > 0
      ? parsed.reply
      : "Got it.";
  const rawPatches = Array.isArray(parsed.patches) ? parsed.patches : [];
  const patches = rawPatches.filter(
    (p): p is { path: string; value: unknown } =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as { path?: unknown }).path === "string",
  );
  const sectionConfirmed =
    typeof parsed.sectionConfirmed === "string" &&
    ["revenue", "costs", "workingCapital", "loan", "management"].includes(
      parsed.sectionConfirmed,
    )
      ? parsed.sectionConfirmed
      : null;

  return NextResponse.json({ ok: true, reply, patches, sectionConfirmed });
}

async function refineSectionAction(
  dealId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const section = typeof body.section === "string" ? (body.section as string) : "";
  const feedback =
    typeof body.feedback === "string" ? (body.feedback as string).trim() : "";
  const packageId = typeof body.packageId === "string" ? (body.packageId as string) : "";

  const column = SECTION_COLUMNS[section];
  if (!column) {
    return NextResponse.json(
      { ok: false, error: `Unknown section: ${section}` },
      { status: 400 },
    );
  }
  if (!feedback) {
    return NextResponse.json(
      { ok: false, error: "Feedback is required" },
      { status: 400 },
    );
  }
  if (!packageId) {
    return NextResponse.json(
      { ok: false, error: "packageId is required" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  const [pkgRes, dealRes, research] = await Promise.all([
    sb
      .from("buddy_sba_packages")
      .select(`id, deal_id, ${column}`)
      .eq("id", packageId)
      .eq("deal_id", dealId)
      .maybeSingle(),
    sb
      .from("deals")
      .select("name, deal_type, loan_amount")
      .eq("id", dealId)
      .maybeSingle(),
    extractResearchForBusinessPlan(dealId).catch(() => null),
  ]);

  if (!pkgRes.data) {
    return NextResponse.json(
      { ok: false, error: "Package not found for this deal" },
      { status: 404 },
    );
  }

  const pkgRow = pkgRes.data as unknown as Record<string, unknown>;
  const previousText =
    typeof pkgRow[column] === "string" ? (pkgRow[column] as string) : "";
  const dealName = dealRes.data?.name ?? "the borrower";
  const loanType = dealRes.data?.deal_type ?? "sba_7a";
  const loanAmount = Number(dealRes.data?.loan_amount ?? 0) || 0;

  const researchSnippet = buildResearchSnippet(section, research);

  const prompt = `You are rewriting one section of an SBA business plan based on borrower feedback. The borrower has reviewed the original text and wants specific changes.

Section: ${SECTION_LABELS[section] ?? section}
Borrower: ${dealName}
Loan: ${String(loanType).replace("_", " ").toUpperCase()} — $${loanAmount.toLocaleString()}

Tone: professional, factual, optimistic but grounded. Write in third person. Do NOT invent market statistics. Do NOT use superlatives. Do NOT mention loan approval, denial, or risk grade.

=== PREVIOUS SECTION TEXT ===
${previousText || "(no prior text — write fresh)"}

=== BORROWER FEEDBACK ===
${feedback}

=== RELEVANT RESEARCH (use sparingly, only when reinforcing the borrower's correction) ===
${researchSnippet || "(no research available)"}

=== INSTRUCTIONS ===
Rewrite the section incorporating the borrower's feedback. Keep the same professional tone and approximate length. Preserve any factual content from the original that the feedback does NOT contradict. If the feedback contradicts the original, the borrower wins — they know their business.

Return ONLY valid JSON: { "updatedText": "<the rewritten section as a single string>" }`;

  let updatedText = "";
  try {
    const raw = await callGeminiJSON(prompt);
    let stripped = raw.trim();
    if (stripped.startsWith("```")) {
      stripped = stripped.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
    }
    const parsed = JSON.parse(stripped) as { updatedText?: string };
    updatedText = typeof parsed.updatedText === "string" ? parsed.updatedText : "";
  } catch (err) {
    console.error("[sba/refine-section] Gemini call failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not rewrite section. Please try again." },
      { status: 502 },
    );
  }

  if (!updatedText) {
    return NextResponse.json(
      { ok: false, error: "Empty response from rewriter" },
      { status: 502 },
    );
  }

  const { error: updErr } = await sb
    .from("buddy_sba_packages")
    .update({ [column]: updatedText, updated_at: new Date().toISOString() })
    .eq("id", packageId)
    .eq("deal_id", dealId);
  if (updErr) {
    console.error(
      "[sba/refine-section] update failed:",
      updErr.code,
      updErr.message,
      updErr.details,
      updErr.hint,
    );
    return NextResponse.json(
      { ok: false, error: "Saved rewrite failed to persist" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, updatedText });
}

function buildResearchSnippet(
  section: string,
  research: Awaited<ReturnType<typeof extractResearchForBusinessPlan>> | null,
): string {
  if (!research) return "";
  const parts: string[] = [];
  if (
    section === "industry_analysis" ||
    section === "executive_summary" ||
    section === "business_overview_narrative"
  ) {
    if (research.industryOverview) parts.push(`Industry Overview: ${research.industryOverview}`);
    if (research.industryOutlook) parts.push(`Industry Outlook: ${research.industryOutlook}`);
  }
  if (
    section === "marketing_strategy" ||
    section.startsWith("swot_") ||
    section === "operations_plan"
  ) {
    if (research.competitiveLandscape)
      parts.push(`Competitive Landscape: ${research.competitiveLandscape}`);
    if (research.marketIntelligence)
      parts.push(`Market Intelligence: ${research.marketIntelligence}`);
  }
  if (section === "business_overview_narrative") {
    if (research.borrowerProfile) parts.push(`Borrower Profile: ${research.borrowerProfile}`);
    if (research.managementIntelligence)
      parts.push(`Management Intelligence: ${research.managementIntelligence}`);
  }
  if (section === "sensitivity_narrative") {
    if (research.threeToFiveYearOutlook)
      parts.push(`3-5 Year Outlook: ${research.threeToFiveYearOutlook}`);
  }
  return parts.join("\n\n");
}

async function patchAssumptionsAction(
  dealId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const sbaGate = await ensureSbaDealOrReturn403(dealId);
  if (sbaGate) return sbaGate;

  const patch = (body.patch as Record<string, unknown>) ?? {};
  const sb = supabaseAdmin();

  const upsertData: Record<string, unknown> = {
    deal_id: dealId,
    updated_at: new Date().toISOString(),
  };

  if (patch.revenueStreams !== undefined) upsertData.revenue_streams = patch.revenueStreams;
  if (patch.costAssumptions !== undefined) upsertData.cost_assumptions = patch.costAssumptions;
  if (patch.workingCapital !== undefined) upsertData.working_capital = patch.workingCapital;
  if (patch.loanImpact !== undefined) upsertData.loan_impact = patch.loanImpact;
  if (patch.managementTeam !== undefined) upsertData.management_team = patch.managementTeam;
  if (patch.status !== undefined) {
    upsertData.status = patch.status;
    if (patch.status === "confirmed") {
      upsertData.confirmed_at = new Date().toISOString();
    }
  }

  const { error } = await sb
    .from("buddy_sba_assumptions")
    .upsert(upsertData, { onConflict: "deal_id" });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function updateBorrowerStoryAction(
  dealId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const patch: Partial<Omit<BorrowerStory, "dealId" | "capturedAt">> = {};
  const assign = <K extends keyof typeof patch>(
    key: K,
    value: (typeof patch)[K] | undefined,
  ) => {
    if (value !== undefined) patch[key] = value;
  };

  assign("originStory", asTrimmedStringOrNull(body.originStory));
  assign("competitiveInsight", asTrimmedStringOrNull(body.competitiveInsight));
  assign("idealCustomer", asTrimmedStringOrNull(body.idealCustomer));
  assign("growthStrategy", asTrimmedStringOrNull(body.growthStrategy));
  assign("biggestRisk", asTrimmedStringOrNull(body.biggestRisk));
  assign("personalVision", asTrimmedStringOrNull(body.personalVision));
  assign("voiceFormality", asVoiceFormality(body.voiceFormality));
  assign("voiceMetaphors", asStringArray(body.voiceMetaphors));
  assign("voiceValues", asStringArray(body.voiceValues));
  assign("capturedVia", asCapturedVia(body.capturedVia));

  await saveBorrowerStory(dealId, patch);
  const story = await loadBorrowerStory(dealId);
  return NextResponse.json({ ok: true, story });
}

async function updateGuarantorCashflowAction(
  dealId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const rows = (body.rows ?? body.body) as unknown;
  if (!Array.isArray(rows)) {
    return NextResponse.json(
      { ok: false, error: "Body must contain rows array (or body array)." },
      { status: 400 },
    );
  }

  type CashflowRow = {
    entity_id: string;
    w2_salary?: number;
    other_personal_income?: number;
    mortgage_payment?: number;
    auto_payments?: number;
    student_loans?: number;
    credit_card_minimums?: number;
    other_personal_debt?: number;
    personal_income_notes?: string;
    personal_debt_notes?: string;
  };

  const sb = supabaseAdmin();

  const upsertData = (rows as CashflowRow[])
    .filter((r) => typeof r.entity_id === "string" && r.entity_id.length > 0)
    .map((r) => ({
      deal_id: dealId,
      entity_id: r.entity_id,
      w2_salary: r.w2_salary ?? 0,
      other_personal_income: r.other_personal_income ?? 0,
      mortgage_payment: r.mortgage_payment ?? 0,
      auto_payments: r.auto_payments ?? 0,
      student_loans: r.student_loans ?? 0,
      credit_card_minimums: r.credit_card_minimums ?? 0,
      other_personal_debt: r.other_personal_debt ?? 0,
      personal_income_notes: r.personal_income_notes ?? null,
      personal_debt_notes: r.personal_debt_notes ?? null,
      updated_at: new Date().toISOString(),
    }));

  if (upsertData.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const { error } = await sb
    .from("buddy_guarantor_cashflow")
    .upsert(upsertData, { onConflict: "deal_id,entity_id" });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: upsertData.length });
}

async function reviewLifecycleAction(
  dealId: string,
  action: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const reviewAction = action.replace(/^review-/, "") as
    | "approve"
    | "request-changes"
    | "submit";
  const notes = typeof body.notes === "string" ? (body.notes as string) : null;

  const sb = supabaseAdmin();

  const { data: current, error: loadErr } = await sb
    .from("buddy_sba_packages")
    .select("id, status")
    .eq("deal_id", dealId)
    .order("version_number", { ascending: false, nullsFirst: false })
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json(
      { ok: false, error: loadErr.message },
      { status: 500 },
    );
  }
  if (!current) {
    return NextResponse.json(
      { ok: false, error: "No SBA package found for this deal." },
      { status: 404 },
    );
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  if (reviewAction === "approve") {
    patch.status = "reviewed";
    patch.reviewed_at = now;
    if (notes) patch.reviewer_notes = notes;
  } else if (reviewAction === "request-changes") {
    patch.status = "revision_requested";
    patch.revision_requested_at = now;
    if (notes) patch.reviewer_notes = notes;
  } else if (reviewAction === "submit") {
    if (current.status !== "reviewed") {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot submit from status "${current.status}". Approve the package first.`,
        },
        { status: 409 },
      );
    }
    patch.status = "submitted";
    patch.submitted_at = now;
  }

  const { error: upErr } = await sb
    .from("buddy_sba_packages")
    .update(patch)
    .eq("id", current.id);

  if (upErr) {
    return NextResponse.json(
      { ok: false, error: upErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, status: patch.status });
}

async function inlineEditNarrativeAction(
  dealId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const field = typeof body.field === "string" ? (body.field as string) : "";
  const value = body.value;

  if (!field || typeof value !== "string") {
    return NextResponse.json(
      { ok: false, error: "field (string) and value (string) are required" },
      { status: 400 },
    );
  }
  if (!EDITABLE_NARRATIVE_FIELDS.has(field)) {
    return NextResponse.json(
      { ok: false, error: `Field "${field}" is not inline-editable.` },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  const { data: current, error: loadErr } = await sb
    .from("buddy_sba_packages")
    .select("id")
    .eq("deal_id", dealId)
    .order("version_number", { ascending: false, nullsFirst: false })
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json({ ok: false, error: loadErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json(
      { ok: false, error: "No SBA package found for this deal." },
      { status: 404 },
    );
  }

  const { error: upErr } = await sb
    .from("buddy_sba_packages")
    .update({ [field]: value })
    .eq("id", current.id);

  if (upErr) {
    return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, field });
}

async function preparePackageRunAction(
  dealId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const packageTemplateCode = (body.packageTemplateCode as string) ?? "SBA_7A_BASE";
  const product = (body.product as "7a" | "504" | "express") ?? "7a";
  const answers = (body.answers ?? {}) as Record<string, unknown>;
  const borrowerData = (body.borrowerData ?? null) as Record<string, unknown> | null;
  const token = (body.token ?? null) as string | null;

  const supabase = getSupabaseServerClient();

  const res = await prepareSbaPackage({
    supabase,
    dealId,
    token,
    packageTemplateCode,
    product,
    answers,
    borrowerData,
  });

  return NextResponse.json({
    ok: true,
    packageRunId: res.packageRunId,
    itemCount: res.itemCount,
  });
}

async function generatePackageRunPdfAction(
  dealId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const packageRunId = typeof body.packageRunId === "string" ? (body.packageRunId as string) : "";
  if (!packageRunId) {
    return NextResponse.json(
      { ok: false, error: "packageRunId is required" },
      { status: 400 },
    );
  }
  const onlyItemId = (body.onlyItemId as string | undefined) ?? undefined;

  const supabase = getSupabaseServerClient();

  const { data: items, error: iErr } = await supabase
    .from("sba_package_run_items")
    .select("id,template_code,title,fill_run_id,required,status")
    .eq("package_run_id", packageRunId);

  if (iErr) {
    throw new Error(`package_items_load_failed: ${iErr.message}`);
  }

  const list = (items ?? []).filter(
    (it: { id: string }) => !onlyItemId || it.id === onlyItemId,
  );

  const results: Array<Record<string, unknown>> = [];

  for (const it of list) {
    const fillRunId = (it as { fill_run_id: string | null }).fill_run_id;

    if (!fillRunId) {
      await supabase
        .from("sba_package_run_items")
        .update({ status: "failed", error: "Missing fill_run_id" })
        .eq("id", (it as { id: string }).id);
      results.push({
        itemId: (it as { id: string }).id,
        ok: false,
        error: "Missing fill_run_id",
      });
      continue;
    }

    try {
      const out = await generatePdfForFillRun({ supabase, dealId, fillRunId });

      await supabase
        .from("sba_package_run_items")
        .update({
          status: "generated",
          output_storage_path: out.storagePath ?? null,
          output_file_name: out.fileName ?? `${(it as { template_code: string }).template_code}.pdf`,
          error: null,
        })
        .eq("id", (it as { id: string }).id);

      results.push({ itemId: (it as { id: string }).id, ok: true, ...out });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "generate_failed";
      await supabase
        .from("sba_package_run_items")
        .update({ status: "failed", error: msg })
        .eq("id", (it as { id: string }).id);
      results.push({ itemId: (it as { id: string }).id, ok: false, error: msg });
    }
  }

  const anyFailed = results.some((r) => !r.ok);
  await supabase
    .from("sba_package_runs")
    .update({ status: anyFailed ? "failed" : "generated" })
    .eq("id", packageRunId);

  return NextResponse.json({ ok: true, packageRunId, results });
}

async function recomputeServicingAction(
  dealId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const program = (body.program ?? "7A") as "7A" | "504" | "EXPRESS" | "CAPLINES" | "OTHER";
  const closing_date = (body.closing_date ?? null) as string | null;

  await ensureSbaLoanAndMilestones({
    dealId,
    program,
    closingDate: closing_date,
  });
  const result = await recomputeSbaServicing(dealId);

  return NextResponse.json({ ok: true, result });
}
