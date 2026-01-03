import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { isDemoMode, demoState } from "@/lib/demo/demoMode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/command
 * Returns a cinematic "command center" view of the deal pipeline.
 *
 * Contract:
 * { ok:true, state, now, items:[{ id, at, type, title, detail, level }] }
 *
 * Data source (prod): deal_pipeline_ledger (canonical ledger table)
 * Demo mode: ?__mode=demo&__state=empty|converging|ready|blocked
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const searchParams = req.nextUrl.searchParams;

    // Demo mode support
    if (isDemoMode(searchParams)) {
      const state = demoState(searchParams);
      const now = new Date().toISOString();

      // Minimal but useful demo timeline
      const items =
        state === "empty"
          ? [
              {
                id: "demo-1",
                at: now,
                type: "system",
                title: "Waiting for intake",
                detail: "No checklist has been seeded yet.",
                level: "info",
              },
            ]
          : state === "converging"
          ? [
              {
                id: "demo-1",
                at: now,
                type: "system",
                title: "Auto-seed running",
                detail: "Checklist engine is matching uploads to required items.",
                level: "info",
              },
              {
                id: "demo-2",
                at: now,
                type: "doc",
                title: "Document matched",
                detail: "Business tax returns → IRS_BUSINESS_2Y",
                level: "success",
              },
            ]
          : state === "blocked"
          ? [
              {
                id: "demo-1",
                at: now,
                type: "error",
                title: "OCR provider unavailable",
                detail: "A downstream service is failing. Retry scheduled.",
                level: "error",
              },
            ]
          : [
              {
                id: "demo-1",
                at: now,
                type: "system",
                title: "Deal ready",
                detail: "Checklist is satisfied and underwriting can proceed.",
                level: "success",
              },
            ];

      return NextResponse.json({ ok: true, state, now, items });
    }

    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    // Pull latest ledger events for the deal (most recent first)
    const { data, error } = await sb
      .from("deal_pipeline_ledger")
      .select("id, created_at, stage, status, payload, error")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[/api/deals/[dealId]/command] DB error:", error);
      return NextResponse.json(
        { ok: false, items: [], error: "Database error loading command timeline" },
        { status: 500 }
      );
    }

    const items = (data ?? []).map((row: any) => ({
      id: row.id,
      at: row.created_at,
      type: row.stage ?? "event",
      title: `${row.stage ?? "event"}: ${row.status ?? "unknown"}`,
      detail: row.error || (row.payload ? JSON.stringify(row.payload) : null),
      level: row.error ? "error" : row.status === "success" || row.status === "completed" ? "success" : "info",
    }));

    const state = items.length === 0 ? "empty" : "ready";
    return NextResponse.json({ ok: true, state, now: new Date().toISOString(), items });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/command] Unexpected error:", e);
    return NextResponse.json(
      { ok: false, items: [], error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
