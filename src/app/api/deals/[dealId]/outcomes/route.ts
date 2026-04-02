/**
 * Outcomes API — Phase 66C
 *
 * GET /api/deals/[dealId]/outcomes
 *   Returns aggregated outcome data for the banker outcome dashboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const [recommendationsRes, trustEventsRes, upliftRes, borrowerActionsRes] =
    await Promise.all([
      sb
        .from("buddy_recommendation_outcomes")
        .select(
          "id, recommendation_id, outcome_type, acceptance_status, usefulness_rating, override_reason, created_at",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(50),
      sb
        .from("buddy_banker_trust_events")
        .select(
          "id, event_type, trust_delta, reason, evidence_json, created_at",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(50),
      sb
        .from("buddy_readiness_uplift_snapshots")
        .select(
          "id, before_score, after_score, score_delta, contributing_factors_json, created_at",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(20),
      sb
        .from("buddy_borrower_actions_taken")
        .select(
          "id, action_type, action_category, status, completed_at, created_at",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  return NextResponse.json({
    recommendations: recommendationsRes.data ?? [],
    trustEvents: trustEventsRes.data ?? [],
    uplift: upliftRes.data ?? [],
    borrowerActions: borrowerActionsRes.data ?? [],
  });
}
