import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveRelationshipDistressState } from "@/core/special-assets-fusion/deriveRelationshipDistressState";

export const runtime = "nodejs";

type Params = Promise<{ relationshipId: string }>;

/**
 * GET /api/relationships/[relationshipId]/distress/summary
 * Returns relationship-level distress rollup across all linked deals.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { relationshipId } = await ctx.params;

    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    const { data: bu } = await sb
      .from("bank_users")
      .select("bank_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!bu) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    // Get all deals linked to this relationship.
    // operating_state is intentionally NOT selected: the column does not
    // exist on the production deals table. The downstream rollup historically
    // received the `?? "performing"` fallback for every deal anyway, so the
    // observable behavior is unchanged.
    const { data: deals } = await sb
      .from("deals")
      .select("id")
      .eq("relationship_id", relationshipId)
      .eq("bank_id", bu.bank_id);

    // Get active watchlist/workout cases for these deals
    const dealIds = (deals ?? []).map((d: { id: string }) => d.id);

    const [watchlistRes, workoutRes] = await Promise.all([
      dealIds.length > 0
        ? sb
            .from("deal_watchlist_cases")
            .select("deal_id, severity")
            .in("deal_id", dealIds)
            .eq("status", "active")
        : { data: [] },
      dealIds.length > 0
        ? sb
            .from("deal_workout_cases")
            .select("deal_id, severity")
            .in("deal_id", dealIds)
            .in("status", ["active", "modification_in_process", "forbearance_in_process", "liquidation_path", "legal_path"])
        : { data: [] },
    ]);

    const watchlistMap = new Map<string, string>();
    for (const w of (watchlistRes as any).data ?? []) {
      watchlistMap.set(w.deal_id, w.severity);
    }

    const workoutMap = new Map<string, string>();
    for (const w of (workoutRes as any).data ?? []) {
      workoutMap.set(w.deal_id, w.severity);
    }

    const dealInputs = (deals ?? []).map((d: { id: string }) => ({
      dealId: d.id,
      // operating_state is not selected (column does not exist in production).
      // Hardcode the historical fallback so deriveRelationshipDistressState's
      // input contract is satisfied; downstream behavior is unchanged.
      operatingState: "performing",
      activeWatchlistSeverity: watchlistMap.get(d.id) ?? null,
      activeWorkoutSeverity: workoutMap.get(d.id) ?? null,
    }));

    const distressState = deriveRelationshipDistressState({ deals: dealInputs });

    return NextResponse.json({
      ok: true,
      distressState,
      activeDealCount: dealInputs.length,
      activeWatchlistCount: watchlistMap.size,
      activeWorkoutCount: workoutMap.size,
      highestSeverity:
        [...workoutMap.values(), ...watchlistMap.values()]
          .sort((a, b) => {
            const order = ["critical", "high", "moderate", "low"];
            return order.indexOf(a) - order.indexOf(b);
          })[0] ?? null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
