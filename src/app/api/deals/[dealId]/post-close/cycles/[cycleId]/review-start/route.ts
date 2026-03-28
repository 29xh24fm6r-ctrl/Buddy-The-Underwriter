import "server-only";

/**
 * POST /api/deals/[dealId]/post-close/cycles/[cycleId]/review-start
 *
 * Moves cycle: submitted -> under_review
 */

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; cycleId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId, cycleId } = await ctx.params;
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await sb
    .from("deal_monitoring_cycles")
    .update({ status: "under_review", review_started_at: now })
    .eq("id", cycleId)
    .eq("deal_id", dealId)
    .eq("status", "submitted");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await sb.from("deal_timeline_events").insert({
    deal_id: dealId,
    kind: "monitoring_cycle.review_started",
    title: "Monitoring review started",
    visible_to_borrower: false,
    meta: { cycle_id: cycleId, started_by: userId },
  });

  return NextResponse.json({ ok: true });
}
