/**
 * Borrower Progress API — Phase 66C
 *
 * GET /api/deals/[dealId]/borrower-progress
 *   Returns aggregated borrower progress data.
 *   Selects actual DB schema columns and maps through shared row mappers.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  borrowerActionRowToApi,
  upliftRowToApi,
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

  const [actionsRes, upliftRes] = await Promise.all([
    sb
      .from("buddy_borrower_actions_taken")
      .select(
        "id, action_key, action_source, status, evidence_json, completed_at, created_at",
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(100),
    sb
      .from("buddy_readiness_uplift_snapshots")
      .select(
        "id, readiness_score_before, readiness_score_after, uplift_summary_json, created_at",
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // Surface query errors explicitly
  const errors: string[] = [];
  if (actionsRes.error) {
    console.error("[borrower-progress] actions query failed", { dealId, error: actionsRes.error.message });
    errors.push("actions");
  }
  if (upliftRes.error) {
    console.error("[borrower-progress] uplift query failed", { dealId, error: upliftRes.error.message });
    errors.push("uplift");
  }

  if (errors.length === 2) {
    return NextResponse.json({ error: "Failed to load borrower progress data" }, { status: 500 });
  }

  const actions = actionsRes.data ?? [];
  const uplift = upliftRes.data ?? [];

  // Compute milestone rate from typed action status
  const completed = actions.filter((row) => row.status === "completed").length;
  const milestoneRate = {
    total: actions.length,
    completed,
    rate: actions.length > 0 ? completed / actions.length : 0,
  };

  return NextResponse.json({
    actions: actions.map(borrowerActionRowToApi),
    uplift: uplift.map(upliftRowToApi),
    milestoneRate,
    ...(errors.length > 0 ? { partialFailure: errors } : {}),
  });
}
