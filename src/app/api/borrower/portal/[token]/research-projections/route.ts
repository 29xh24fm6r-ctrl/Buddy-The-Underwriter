// src/app/api/borrower/portal/[token]/research-projections/route.ts
// Phase 85-BPG-ELITE — Trigger research-powered auto-generation of SBA
// assumptions for the live projection dashboard. Token-authed; idempotent
// against confirmed assumptions (won't overwrite borrower-confirmed work).

import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateProjectionsFromResearch } from "@/lib/sba/sbaResearchProjectionGenerator";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 },
    );
  }

  const sb = supabaseAdmin();

  // Skip regeneration if borrower has already confirmed projections.
  const { data: existing } = await sb
    .from("buddy_sba_assumptions")
    .select("id, status")
    .eq("deal_id", ctx.dealId)
    .maybeSingle();

  if (existing?.status === "confirmed") {
    return NextResponse.json({
      ok: true,
      action: "already_confirmed",
      message: "Projections already confirmed by borrower",
    });
  }

  try {
    const result = await generateProjectionsFromResearch(ctx.dealId);

    const { error } = await sb.from("buddy_sba_assumptions").upsert(
      {
        deal_id: ctx.dealId,
        revenue_streams: result.assumptions.revenueStreams,
        cost_assumptions: result.assumptions.costAssumptions,
        working_capital: result.assumptions.workingCapital,
        loan_impact: result.assumptions.loanImpact,
        management_team: result.assumptions.managementTeam,
        status: "draft",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id" },
    );
    if (error) {
      console.error(
        "[research-projections] upsert error:",
        error.code,
        error.message,
        error.details,
        error.hint,
      );
      return NextResponse.json(
        { ok: false, error: "Failed to persist generated assumptions" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      action: "generated",
      researchNarrative: result.researchNarrative,
      researchContext: result.researchContext,
      confidenceLevel: result.confidenceLevel,
      dataSources: result.dataSources,
      assumptions: result.assumptions,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate projections";
    console.error("[research-projections] error:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
