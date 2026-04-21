import "server-only";

// src/app/api/deals/[dealId]/sba/refine-section/route.ts
// Phase 3 — Section-level borrower refinement loop. Borrower types feedback,
// Buddy rewrites that one narrative section using Gemini Pro and the same
// research/context the original generation used, then we update the
// corresponding column on buddy_sba_packages. Does NOT regenerate the PDF —
// that happens on an explicit "Regenerate PDF" action elsewhere.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { callGeminiJSON } from "@/lib/sba/sbaPackageNarrative";
import { extractResearchForBusinessPlan } from "@/lib/sba/sbaResearchExtractor";

export const runtime = "nodejs";
export const maxDuration = 45;
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

// section_key → buddy_sba_packages column name. Limits surface to the
// narrative columns the renderer reads from the package table.
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

export async function POST(req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: 403 },
    );
  }

  let body: { section?: unknown; feedback?: unknown; packageId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const section = typeof body.section === "string" ? body.section : "";
  const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
  const packageId = typeof body.packageId === "string" ? body.packageId : "";

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

  // Load the current text + minimal deal context.
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
      stripped = stripped
        .replace(/^```(?:json)?\s*/, "")
        .replace(/```\s*$/, "");
    }
    const parsed = JSON.parse(stripped) as { updatedText?: string };
    updatedText =
      typeof parsed.updatedText === "string" ? parsed.updatedText : "";
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
    if (research.industryOverview)
      parts.push(`Industry Overview: ${research.industryOverview}`);
    if (research.industryOutlook)
      parts.push(`Industry Outlook: ${research.industryOutlook}`);
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
    if (research.borrowerProfile)
      parts.push(`Borrower Profile: ${research.borrowerProfile}`);
    if (research.managementIntelligence)
      parts.push(`Management Intelligence: ${research.managementIntelligence}`);
  }
  if (section === "sensitivity_narrative") {
    if (research.threeToFiveYearOutlook)
      parts.push(`3-5 Year Outlook: ${research.threeToFiveYearOutlook}`);
  }
  return parts.join("\n\n");
}
