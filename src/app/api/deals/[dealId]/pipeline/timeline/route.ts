import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type TimelineEvent = {
  event_key: string;
  ui_state: "working" | "waiting" | "done";
  ui_message: string;
  created_at: string;
};

type TimelineResponse =
  | {
      ok: true;
      events: TimelineEvent[];
    }
  | {
      ok: false;
      error: string;
    };

/**
 * GET /api/deals/[dealId]/pipeline/timeline
 * 
 * Returns chronological list of pipeline events for replayable narrative.
 * 
 * Rules:
 * - Read-only
 * - No polling (static snapshot)
 * - Ordered chronologically (oldest first)
 * - Limited to last N events to prevent overwhelming UI
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
): Promise<NextResponse<TimelineResponse>> {
  try {
    const { dealId } = await ctx.params;

    if (!dealId) {
      return NextResponse.json({ ok: false, error: "dealId required" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Fetch recent pipeline events
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");
    
    const { data: events, error: eventsError } = await sb
      .from("deal_pipeline_ledger")
      .select("event_key, ui_state, ui_message, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(Math.min(limit, 100)); // Cap at 100

    if (eventsError) {
      console.error("[timeline] Failed to fetch events:", eventsError);
      return NextResponse.json(
        { ok: false, error: "Failed to fetch timeline" },
        { status: 500 }
      );
    }

    if (!events) {
      return NextResponse.json({
        ok: true,
        events: [],
      });
    }

    // Return chronological (oldest first for timeline narrative)
    const chronological = events.reverse();

    return NextResponse.json({
      ok: true,
      events: chronological,
    });
  } catch (e: any) {
    console.error("[timeline] Unexpected error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Internal error",
      },
      { status: 500 }
    );
  }
}
