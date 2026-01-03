import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

type DiagnosticsResponse =
  | {
      ok: true;
      metrics: {
        in_flight: number;
        stuck: number; // no events >10min
        completed: number;
        total_deals: number;
      };
      deals: Array<{
        deal_id: string;
        latest_event: string;
        latest_state: string;
        latest_message: string;
        last_updated_at: string;
        minutes_since_update: number;
        is_stuck: boolean;
      }>;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * GET /api/admin/pipeline/diagnostics
 * 
 * Admin-only pipeline health & diagnostics.
 * Shows deals grouped by latest state with stuck job detection.
 * 
 * Rules:
 * - Super admin only
 * - Read-only
 * - Aggregates ledger by deal_id
 */
export async function GET(req: NextRequest): Promise<NextResponse<DiagnosticsResponse>> {
  // Require super admin
  const authCheck = await requireSuperAdmin();
  if (!authCheck.ok) {
    return NextResponse.json({ ok: false, error: authCheck.error }, { status: 401 });
  }

  try {
    const sb = supabaseAdmin();

    // Get all deals with their latest pipeline event
    const { data: latestEvents, error: eventsError } = await sb.rpc(
      "get_latest_pipeline_events_per_deal"
    );

    // If RPC doesn't exist, fall back to manual aggregation
    if (eventsError || !latestEvents) {
      // Fallback: fetch recent events and group manually
      const { data: allEvents, error: fallbackError } = await sb
        .from("deal_pipeline_ledger")
        .select("deal_id, event_key, ui_state, ui_message, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);

      if (fallbackError) {
        console.error("[diagnostics] Failed to fetch events:", fallbackError);
        return NextResponse.json(
          { ok: false, error: "Failed to fetch diagnostics" },
          { status: 500 }
        );
      }

      // Group by deal_id and take latest
      const dealMap = new Map<string, any>();
      
      for (const event of allEvents || []) {
        if (!dealMap.has(event.deal_id)) {
          dealMap.set(event.deal_id, event);
        }
      }

      const now = new Date();
      const deals = Array.from(dealMap.values()).map((e) => {
        const lastUpdated = new Date(e.created_at);
        const minutesSince = Math.floor((now.getTime() - lastUpdated.getTime()) / 60000);
        const isStuck = e.ui_state === "working" && minutesSince > 10;

        return {
          deal_id: e.deal_id,
          latest_event: e.event_key,
          latest_state: e.ui_state,
          latest_message: e.ui_message || e.ui_state,
          last_updated_at: e.created_at,
          minutes_since_update: minutesSince,
          is_stuck: isStuck,
        };
      });

      const metrics = {
        in_flight: deals.filter((d) => d.latest_state === "working").length,
        stuck: deals.filter((d) => d.is_stuck).length,
        completed: deals.filter((d) => d.latest_state === "done").length,
        total_deals: deals.length,
      };

      return NextResponse.json({
        ok: true,
        metrics,
        deals,
      });
    }

    // If RPC exists, use its results
    const now = new Date();
    const deals = latestEvents.map((e: any) => {
      const lastUpdated = new Date(e.created_at);
      const minutesSince = Math.floor((now.getTime() - lastUpdated.getTime()) / 60000);
      const isStuck = e.ui_state === "working" && minutesSince > 10;

      return {
        deal_id: e.deal_id,
        latest_event: e.event_key,
        latest_state: e.ui_state,
        latest_message: e.ui_message || e.ui_state,
        last_updated_at: e.created_at,
        minutes_since_update: minutesSince,
        is_stuck: isStuck,
      };
    });

    const metrics = {
      in_flight: deals.filter((d: any) => d.latest_state === "working").length,
      stuck: deals.filter((d: any) => d.is_stuck).length,
      completed: deals.filter((d: any) => d.latest_state === "done").length,
      total_deals: deals.length,
    };

    return NextResponse.json({
      ok: true,
      metrics,
      deals,
    });
  } catch (e: any) {
    console.error("[diagnostics] Unexpected error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Internal error",
      },
      { status: 500 }
    );
  }
}
