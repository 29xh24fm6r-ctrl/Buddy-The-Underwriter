// src/app/api/banker/deals/[dealId]/portal-status/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    requireUserId(req);
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;

    const { data, error } = await sb
      .from("deal_portal_status")
      .select("stage, eta_text, updated_at")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      status: data ?? { stage: "Intake", eta_text: null, updated_at: new Date().toISOString() },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const bankerUserId = requireUserId(req);
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;
    const body = await req.json();

    const stage = String(body?.stage ?? "Intake").trim();
    const etaText = body?.etaText ? String(body.etaText).trim() : null;

    const { error } = await sb
      .from("deal_portal_status")
      .upsert(
        {
          deal_id: dealId,
          stage,
          eta_text: etaText,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "deal_id" }
      );

    if (error) throw error;

    // Create borrower-safe timeline event
    await sb.from("deal_timeline_events").insert({
      deal_id: dealId,
      visibility: "borrower",
      event_type: "STATUS_UPDATE",
      title: "Status updated",
      detail: `Application moved to: ${stage}${etaText ? ` • Estimated: ${etaText}` : ""}`,
      meta: { stage, etaText, updatedBy: bankerUserId },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
