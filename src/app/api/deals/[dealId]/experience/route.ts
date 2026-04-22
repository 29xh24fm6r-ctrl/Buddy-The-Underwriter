/**
 * Banker Experience API — Phase 66B (Commit 8)
 *
 * GET /api/deals/[dealId]/experience
 *   Returns aggregated dashboard data for the banker experience page.
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

  const [changesRes, actionsRes, trustRes, handoffsRes, signalsRes] = await Promise.all([
    sb.from("buddy_material_change_events")
      .select("id, change_type, change_scope, materiality_score, affected_systems_json, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(10),
    sb.from("buddy_action_recommendations")
      .select("id, action_category, priority_score, urgency_score, confidence_score, rationale_json, expected_impact_json, status")
      .eq("deal_id", dealId)
      .eq("visibility_scope", "banker")
      .order("priority_score", { ascending: false })
      .limit(10),
    sb.from("buddy_conclusion_trust")
      .select("conclusion_key, support_type, confidence_level, freshness_status, decision_safe")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(20),
    sb.from("buddy_agent_handoffs")
      .select("id, from_agent_type, to_agent_type, handoff_type, status, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(10),
    sb.from("buddy_monitoring_signals")
      .select("id, signal_type, severity, direction, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return NextResponse.json({
    materialChanges: changesRes.data ?? [],
    actions: actionsRes.data ?? [],
    trust: trustRes.data ?? [],
    handoffs: handoffsRes.data ?? [],
    signals: signalsRes.data ?? [],
  });
}
