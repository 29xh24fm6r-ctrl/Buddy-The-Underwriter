import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ReplayRequest = {
  deal_id: string;
  event_key: string;
};

type ReplayResponse =
  | {
      ok: true;
      replayed: {
        deal_id: string;
        event_key: string;
        created_at: string;
      };
    }
  | {
      ok: false;
      error: string;
    };

/**
 * POST /api/admin/pipeline/replay
 * 
 * Re-emit a ledger event for UI testing.
 * 
 * Rules:
 * - Super admin only
 * - No side effects (just copies existing event with new timestamp)
 * - UI will react via polling
 * - Useful for testing without re-uploading files
 */
export async function POST(req: NextRequest): Promise<NextResponse<ReplayResponse>> {
  try {
    // Require super admin
    await requireSuperAdmin();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body: ReplayRequest = await req.json();

    if (!body.deal_id || !body.event_key) {
      return NextResponse.json(
        { ok: false, error: "deal_id and event_key required" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    // Find the original event to replay
    const { data: originalEvent, error: findError } = await sb
      .from("deal_pipeline_ledger")
      .select("*")
      .eq("deal_id", body.deal_id)
      .eq("event_key", body.event_key)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (findError || !originalEvent) {
      return NextResponse.json(
        { ok: false, error: `Event not found: ${body.event_key} for deal ${body.deal_id}` },
        { status: 404 }
      );
    }

    // Re-emit the event with new timestamp (UI will pick it up via polling)
    const { data: replayedEvent, error: insertError } = await sb
      .from("deal_pipeline_ledger")
      .insert({
        deal_id: originalEvent.deal_id,
        event_key: originalEvent.event_key,
        ui_state: originalEvent.ui_state,
        ui_message: `[REPLAY] ${originalEvent.ui_message || originalEvent.event_key}`,
        meta: {
          ...(originalEvent.meta || {}),
          replayed: true,
          replayed_at: new Date().toISOString(),
          replayed_from: originalEvent.id,
        },
      })
      .select()
      .single();

    if (insertError || !replayedEvent) {
      console.error("[replay] Failed to insert replay event:", insertError);
      return NextResponse.json(
        { ok: false, error: "Failed to replay event" },
        { status: 500 }
      );
    }

    console.log(`[replay] Replayed event: ${body.event_key} for deal ${body.deal_id}`);

    return NextResponse.json({
      ok: true,
      replayed: {
        deal_id: replayedEvent.deal_id,
        event_key: replayedEvent.event_key,
        created_at: replayedEvent.created_at,
      },
    });
  } catch (e: any) {
    console.error("[replay] Unexpected error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Internal error",
      },
      { status: 500 }
    );
  }
}
