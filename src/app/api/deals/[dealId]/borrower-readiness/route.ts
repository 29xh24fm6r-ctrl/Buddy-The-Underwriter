/**
 * Enhanced Borrower Readiness API — Phase 66B (Commit 9)
 *
 * GET /api/deals/[dealId]/borrower-readiness
 *   Returns enriched borrower readiness data: path, levers, cash story, translations, actions.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const [pathRes, actionsRes] = await Promise.all([
    sb.from("buddy_borrower_readiness_paths")
      .select("path_status, primary_constraint, milestones_json, recommended_sequence_json")
      .eq("deal_id", dealId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from("buddy_action_recommendations")
      .select("action_category, rationale_json, confidence_score, expected_impact_json")
      .eq("deal_id", dealId)
      .eq("visibility_scope", "borrower")
      .eq("status", "open")
      .order("priority_score", { ascending: false })
      .limit(10),
  ]);

  const path = pathRes.data ? {
    status: pathRes.data.path_status,
    primaryConstraint: pathRes.data.primary_constraint,
    milestones: pathRes.data.milestones_json ?? [],
  } : null;

  const actions = (actionsRes.data ?? []).map((a: any) => ({
    category: a.action_category,
    title: a.rationale_json?.title ?? null,
    description: a.rationale_json?.description ?? "",
    confidence: a.confidence_score,
  }));

  // Levers, cashStory, translations are populated by the borrower insights engine
  // when generateBorrowerInsights() is called (via POST /api/deals/[dealId]/borrower-insights)
  return NextResponse.json({
    path,
    levers: [],
    cashStory: null,
    translations: [],
    actions,
  });
}
