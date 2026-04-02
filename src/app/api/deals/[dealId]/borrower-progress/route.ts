/**
 * Borrower Progress API — Phase 66C
 *
 * GET /api/deals/[dealId]/borrower-progress
 *   Returns aggregated borrower progress data for the borrower progress page.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const [actionsRes, upliftRes] = await Promise.all([
    sb
      .from("buddy_borrower_actions_taken")
      .select(
        "id, action_type, action_category, status, guidance_category, effectiveness_rating, completed_at, created_at",
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(100),
    sb
      .from("buddy_readiness_uplift_snapshots")
      .select(
        "id, before_score, after_score, score_delta, contributing_factors_json, created_at",
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const actions = actionsRes.data ?? [];
  const uplift = upliftRes.data ?? [];

  // Compute milestone rate: completed / total
  const completed = actions.filter((a) => a.status === "completed").length;
  const milestoneRate = actions.length > 0 ? completed / actions.length : 0;

  return NextResponse.json({
    actions,
    uplift,
    milestoneRate,
  });
}
