/**
 * Outcomes API — Phase 66C
 *
 * GET /api/deals/[dealId]/outcomes
 *   Returns aggregated outcome data for the banker outcome dashboard.
 *   Selects actual DB schema columns and maps through shared row mappers.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  recOutcomeRowToApi,
  trustEventRowToApi,
  upliftRowToApi,
  borrowerActionRowToApi,
} from "@/lib/contracts/phase66b66cRowMappers";

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
          "id, recommendation_id, outcome_status, accepted_by_actor_type, usefulness_score, timing_score, impact_score, overridden, override_reason, created_at",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(50),
      sb
        .from("buddy_banker_trust_events")
        .select(
          "id, event_type, conclusion_key, recommendation_id, payload_json, created_at",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(50),
      sb
        .from("buddy_readiness_uplift_snapshots")
        .select(
          "id, readiness_score_before, readiness_score_after, uplift_summary_json, created_at",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(20),
      sb
        .from("buddy_borrower_actions_taken")
        .select(
          "id, action_key, action_source, status, evidence_json, completed_at, created_at",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  return NextResponse.json({
    recommendations: (recommendationsRes.data ?? []).map(recOutcomeRowToApi),
    trustEvents: (trustEventsRes.data ?? []).map(trustEventRowToApi),
    uplift: (upliftRes.data ?? []).map(upliftRowToApi),
    borrowerActions: (borrowerActionsRes.data ?? []).map(borrowerActionRowToApi),
  });
}
