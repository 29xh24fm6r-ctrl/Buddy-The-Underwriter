// src/app/api/borrower/portal/[token]/generate-pdf/route.ts
// Phase 85-BPG-EXPERIENCE — Borrower-facing projection PDF generation.
// Portal-token gated. Loads confirmed assumptions, runs the forward model,
// generates an actionable roadmap (single Gemini call), renders a 6-page
// borrower PDF, uploads to storage, verifies the bytes, and returns a 5-minute signed URL.

import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computePackageFinancialOutput } from "@/lib/modelEngine/packageFinancialComputation";
import { renderBorrowerProjectionPDF } from "@/lib/sba/sbaBorrowerPDFRenderer";
import { generateActionableRoadmap } from "@/lib/sba/sbaActionableRoadmap";
import { loadBorrowerStoryWithEvidence } from "@/lib/sba/sbaBorrowerStory";
import type {
  Milestone,
  KPITarget,
  RiskContingency,
} from "@/lib/sba/sbaBusinessPlanRoadmap";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
};

const MAX_TOKEN_LENGTH = 512;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

async function withProjectionPdfTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("projection_pdf_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (
    !token ||
    token.length > MAX_TOKEN_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(token)
  ) {
    return json({ ok: false, error: "invalid_token" }, 401);
  }

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await withProjectionPdfTimeout(resolvePortalContext(token), 6_000);
  } catch {
    return json({ ok: false, error: "invalid_token" }, 401);
  }

  const sb = supabaseAdmin();

  const dealResult = await withProjectionPdfTimeout(
    sb
      .from("deals")
      .select("id, bank_id, name, deal_type, loan_amount")
      .eq("id", ctx.dealId)
      .eq("bank_id", ctx.bankId)
      .maybeSingle(),
    8_000,
  ).catch(() => null);
  if (!dealResult || dealResult.error) {
    return json({ ok: false, error: "deal_state_unavailable" }, 503);
  }
  if (
    !dealResult.data ||
    dealResult.data.id !== ctx.dealId ||
    dealResult.data.bank_id !== ctx.bankId
  ) {
    return json({ ok: false, error: "deal_not_found" }, 404);
  }
  const deal = dealResult.data;

  const assumptionsResult = await withProjectionPdfTimeout(
    sb
      .from("buddy_sba_assumptions")
      .select(
        "deal_id, revenue_streams, cost_assumptions, working_capital, loan_impact, management_team, status",
      )
      .eq("deal_id", ctx.dealId)
      .maybeSingle(),
    8_000,
  ).catch(() => null);
  if (!assumptionsResult || assumptionsResult.error) {
    return json({ ok: false, error: "assumptions_state_unavailable" }, 503);
  }
  if (!assumptionsResult.data || assumptionsResult.data.deal_id !== ctx.dealId) {
    return json({ ok: false, error: "assumptions_not_found" }, 404);
  }
  if (assumptionsResult.data.status !== "confirmed") {
    return json({ ok: false, error: "assumptions_not_confirmed" }, 409);
  }
  // Use the same reconciled, read-only financial output as the lender package.
  // This completes all deterministic checks before the roadmap's model call.
  const computed = await withProjectionPdfTimeout(
    computePackageFinancialOutput(ctx.dealId, ctx.bankId), 20_000,
  ).catch(() => null);
  if (!computed?.ok) return json({ ok: false, error: "financial_facts_unavailable" }, 503);
  const { assumptions, baseYear, projectionModel, projectedDscrThreshold } = computed.output;
  const {
    annualProjections: annual,
    monthlyProjections: monthly,
    breakEven,
    sensitivityScenarios: scenarios,
  } = projectionModel;
  const year1 = annual[0];
  if (!year1) {
    return json({ ok: false, error: "projection_unavailable" }, 503);
  }

  // Reconstruct a briefing from the most recent compiled research narrative.
  let researchBriefing = "";
  const missionResult = await withProjectionPdfTimeout(
    sb
      .from("buddy_research_missions")
      .select("id")
      .eq("deal_id", ctx.dealId)
      .eq("status", "complete")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    8_000,
  ).catch(() => null);
  if (!missionResult || missionResult.error) {
    return json({ ok: false, error: "research_state_unavailable" }, 503);
  }

  const mission = missionResult.data;
  if (mission?.id) {
    const narrativeResult = await withProjectionPdfTimeout(
      sb
        .from("buddy_research_narratives")
        .select("sections")
        .eq("mission_id", mission.id)
        .order("compiled_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      8_000,
    ).catch(() => null);
    if (!narrativeResult || narrativeResult.error) {
      return json({ ok: false, error: "research_state_unavailable" }, 503);
    }
    const narrative = narrativeResult.data;
    if (narrative?.sections && Array.isArray(narrative.sections)) {
      const sections = narrative.sections as Array<{
        title?: string;
        body?: string;
      }>;
      researchBriefing = sections
        .slice(0, 4)
        .map((sec) => `${sec.title ?? ""}\n\n${sec.body ?? ""}`.trim())
        .filter(Boolean)
        .join("\n\n")
        .trim();
    }
  }

  const downsideScenario = scenarios.find((s) => s.name === "downside");

  const roadmap = await generateActionableRoadmap({
    businessName: deal?.name ?? "Your Business",
    loanAmount: assumptions.loanImpact.loanAmount || deal?.loan_amount || 0,
    revenue: year1.revenue,
    breakEvenRevenue: breakEven.breakEvenRevenue,
    marginOfSafetyPct: breakEven.marginOfSafetyPct,
    dscrYear1: year1.dscr,
    dscrYear2: annual[1]?.dscr ?? null,
    dscrYear3: annual[2]?.dscr ?? null,
    downsideCoverage: [downsideScenario?.dscrYear1 ?? null, downsideScenario?.dscrYear2 ?? null, downsideScenario?.dscrYear3 ?? null],
    monthlyDebtService: year1.totalDebtService / 12,
    grossMarginPct: year1.grossMarginPct,
    cogsPercent: assumptions.costAssumptions.cogsPercentYear1 ?? 0.3,
    revenueGrowthY1:
      assumptions.revenueStreams[0]?.growthRateYear1 ?? 0.05,
    dscrThreshold: projectedDscrThreshold,
  });

  // God Tier additions — load the most recent SBA package for this deal so we
  // can surface the plan thesis, milestone timeline, KPI dashboard, and risk
  // contingency matrix in the borrower PDF. The story is loaded in parallel
  // for the "Your Vision" page. All fields are optional — the renderer skips
  // sections whose data is absent.
  const [storyResult, packageResult] = await Promise.all([
    withProjectionPdfTimeout(loadBorrowerStoryWithEvidence(ctx.dealId), 8_000).catch(
      () => null,
    ),
    withProjectionPdfTimeout(
      sb
        .from("buddy_sba_packages")
        .select("plan_thesis, milestone_timeline, kpi_dashboard, risk_contingency_matrix")
        .eq("deal_id", ctx.dealId)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      8_000,
    ).catch(() => null),
  ]);
  if (!storyResult || !storyResult.ok || !packageResult || packageResult.error) {
    return json({ ok: false, error: "projection_inputs_unavailable" }, 503);
  }
  const borrowerStory = storyResult.story;
  const packageRow = packageResult.data as {
    plan_thesis: string | null;
    milestone_timeline: Milestone[] | null;
    kpi_dashboard: KPITarget[] | null;
    risk_contingency_matrix: RiskContingency[] | null;
  } | null;

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await withProjectionPdfTimeout(
      renderBorrowerProjectionPDF({
        businessName: deal?.name ?? "Your Business",
        loanAmount: assumptions.loanImpact.loanAmount || deal?.loan_amount || 0,
        loanType: deal?.deal_type ?? "SBA",
        dscrThreshold: projectedDscrThreshold,
        baseYear,
        annualProjections: annual,
        monthlyProjections: monthly,
        breakEven,
        sensitivityScenarios: scenarios,
        researchBriefing,
        actionableRoadmap: roadmap,
        generatedDate: new Date().toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
        planThesis: packageRow?.plan_thesis ?? null,
        milestoneTimeline: packageRow?.milestone_timeline ?? null,
        kpiDashboard: packageRow?.kpi_dashboard ?? null,
        riskContingencyMatrix: packageRow?.risk_contingency_matrix ?? null,
        borrowerStory,
      }),
      20_000,
    );
  } catch {
    return json({ ok: false, error: "pdf_render_unavailable" }, 503);
  }

  if (
    !Buffer.isBuffer(pdfBuffer) ||
    pdfBuffer.length === 0 ||
    pdfBuffer.length > MAX_PDF_BYTES
  ) {
    return json({ ok: false, error: "pdf_render_unavailable" }, 503);
  }

  const pdfPath = `borrower-projections/${ctx.dealId}/${randomUUID()}.pdf`;
  const bucket = sb.storage.from("deal-documents");
  const cleanupGeneratedObject = async () => {
    await withProjectionPdfTimeout(bucket.remove([pdfPath]), 8_000).catch(
      () => undefined,
    );
  };

  const uploadResult = await withProjectionPdfTimeout(
    bucket.upload(pdfPath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
    }),
    12_000,
  ).catch(() => null);
  if (!uploadResult || uploadResult.error) {
    return json({ ok: false, error: "pdf_storage_unavailable" }, 503);
  }

  const storedResult = await withProjectionPdfTimeout(
    bucket.download(pdfPath),
    12_000,
  ).catch(() => null);
  if (!storedResult || storedResult.error || !storedResult.data) {
    await cleanupGeneratedObject();
    return json({ ok: false, error: "pdf_storage_unverified" }, 503);
  }

  let storedBytes: Buffer;
  try {
    storedBytes = Buffer.from(await storedResult.data.arrayBuffer());
  } catch {
    await cleanupGeneratedObject();
    return json({ ok: false, error: "pdf_storage_unverified" }, 503);
  }
  const contentIdentity = (value: Buffer) =>
    createHash("sha256").update(value).digest("hex");
  if (
    storedBytes.length !== pdfBuffer.length ||
    contentIdentity(storedBytes) !== contentIdentity(pdfBuffer)
  ) {
    await cleanupGeneratedObject();
    return json({ ok: false, error: "pdf_storage_unverified" }, 503);
  }

  const signResult = await withProjectionPdfTimeout(
    bucket.createSignedUrl(pdfPath, 300),
    12_000,
  ).catch(() => null);
  const pdfUrl = signResult?.data?.signedUrl ?? "";
  if (
    !signResult ||
    signResult.error ||
    !/^https:\/\//i.test(pdfUrl) ||
    pdfUrl.length > 8_192
  ) {
    await cleanupGeneratedObject();
    return json({ ok: false, error: "pdf_delivery_unavailable" }, 503);
  }

  const audit = await withProjectionPdfTimeout(
    sb
      .from("deal_pipeline_ledger")
      .insert({
        deal_id: ctx.dealId,
        bank_id: ctx.bankId,
        event_key: "borrower.projection_pdf_generated",
        stage: "borrower.projection_pdf_generated",
        status: "ok",
        ui_state: "done",
        ui_message: "Borrower projection PDF generated",
        meta: {
          provider: "supabase",
          artifact: "borrower_projection_pdf",
          byte_length: pdfBuffer.length,
        },
        provider_metrics: null,
      } as any)
      .select("id, deal_id, bank_id, event_key, status")
      .single(),
    8_000,
  ).catch(() => null);
  if (
    !audit ||
    audit.error ||
    !audit.data?.id ||
    audit.data.deal_id !== ctx.dealId ||
    audit.data.bank_id !== ctx.bankId ||
    audit.data.event_key !== "borrower.projection_pdf_generated" ||
    audit.data.status !== "ok"
  ) {
    await cleanupGeneratedObject();
    return json({ ok: false, error: "pdf_audit_unavailable" }, 503);
  }

  return json({ ok: true, pdfUrl });
}
