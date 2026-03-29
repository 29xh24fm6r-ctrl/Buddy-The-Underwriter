import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { validateResolution } from "@/core/special-assets-fusion/validateResolution";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

/**
 * POST /api/deals/[dealId]/special-assets/return-to-pass/validate
 * Validates whether a workout case can be returned to pass.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;

    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    // Get active workout case
    const { data: workout } = await sb
      .from("deal_workout_cases")
      .select("id, status, resolution_outcome")
      .eq("deal_id", dealId)
      .eq("status", "active")
      .maybeSingle();

    if (!workout) {
      return NextResponse.json(
        { ok: false, error: "No active workout case found." },
        { status: 404 },
      );
    }

    // Count open action items
    const { data: openItems } = await sb
      .from("deal_workout_action_items")
      .select("id, status")
      .eq("workout_case_id", workout.id)
      .in("status", ["open", "in_progress", "blocked"]);

    const { data: waivedItems } = await sb
      .from("deal_workout_action_items")
      .select("id")
      .eq("workout_case_id", workout.id)
      .not("waived_at", "is", null);

    const body = await req.json().catch(() => ({}));

    const result = validateResolution({
      openActionItemCount: (openItems ?? []).length,
      waivedActionItemCount: (waivedItems ?? []).length,
      hasResolutionOutcome: !!body.outcome,
      hasBankerSummary: !!body.summary && body.summary.length > 0,
      hasEvidenceAttached: Array.isArray(body.evidenceIds) && body.evidenceIds.length > 0,
      isReturnToPass: true,
      hasPassRationale: !!body.passRationale && body.passRationale.length > 0,
    });

    return NextResponse.json({ ok: true, valid: result.valid, blockers: result.blockers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
