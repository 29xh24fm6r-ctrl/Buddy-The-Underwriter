import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * GET /api/deals/[dealId]/events
 * 
 * Returns recent deal events for activity feed
 */
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { dealId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const sb = supabaseAdmin();

    const { data: events, error } = await sb
      .from("deal_events")
      .select("id, kind, metadata, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Events fetch error:", error);
      return NextResponse.json(
        { ok: false, error: "Failed to fetch events" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      events: events || [],
      count: events?.length || 0,
    });
  } catch (error: any) {
    console.error("Events API error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
