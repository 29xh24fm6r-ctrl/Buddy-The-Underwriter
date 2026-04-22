/**
 * Outcomes API — Phase 66C
 *
 * GET /api/deals/[dealId]/outcomes
 *   Returns aggregated outcome data for the banker outcome dashboard.
 *   Selects actual DB schema columns and maps through shared row mappers.
 *   Surfaces query errors explicitly instead of silently returning empty arrays.
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
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
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

  // Surface query errors explicitly
  const errors: string[] = [];
  if (recommendationsRes.error) {
    console.error("[outcomes] recommendations query failed", { dealId, error: recommendationsRes.error.message });
    errors.push("recommendations");
  }
  if (trustEventsRes.error) {
    console.error("[outcomes] trustEvents query failed", { dealId, error: trustEventsRes.error.message });
    errors.push("trustEvents");
  }
  if (upliftRes.error) {
    console.error("[outcomes] uplift query failed", { dealId, error: upliftRes.error.message });
    errors.push("uplift");
  }
  if (borrowerActionsRes.error) {
    console.error("[outcomes] borrowerActions query failed", { dealId, error: borrowerActionsRes.error.message });
    errors.push("borrowerActions");
  }

  if (errors.length === 4) {
    return NextResponse.json({ error: "Failed to load outcome data" }, { status: 500 });
  }

  return NextResponse.json({
    recommendations: (recommendationsRes.data ?? []).map(recOutcomeRowToApi),
    trustEvents: (trustEventsRes.data ?? []).map(trustEventRowToApi),
    uplift: (upliftRes.data ?? []).map(upliftRowToApi),
    borrowerActions: (borrowerActionsRes.data ?? []).map(borrowerActionRowToApi),
    ...(errors.length > 0 ? { partialFailure: errors } : {}),
  });
}
