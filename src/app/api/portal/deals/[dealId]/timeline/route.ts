// src/app/api/portal/deals/[dealId]/timeline/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace(/^Bearer\s+/i, "");

    const invite = await requireValidInvite(token);
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;
    // Verify deal matches invite
    if (invite.deal_id !== dealId) throw new Error("Deal ID mismatch");

    const { data, error } = await sb
      .from("deal_timeline_events")
      .select("id, deal_id, event_type, title, detail, created_at, meta")
      .eq("deal_id", dealId)
      .eq("visibility", "borrower")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return NextResponse.json({ ok: true, events: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
