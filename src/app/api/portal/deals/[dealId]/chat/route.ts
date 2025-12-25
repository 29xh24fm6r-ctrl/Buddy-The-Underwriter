// src/app/api/portal/deals/[dealId]/chat/route.ts
import { NextResponse } from "next/server";
import { requireValidInvite } from "@/lib/portal/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
      .from("deal_portal_chat_messages")
      .select("id, sender_role, sender_display, body, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw error;
    return NextResponse.json({ ok: true, messages: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}

export async function POST(
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
    const body = await req.json();

    // Verify deal matches invite
    if (invite.deal_id !== dealId) throw new Error("Deal ID mismatch");

    const text = String(body?.body ?? "").trim();
    if (!text) throw new Error("Message is empty.");

    // Borrower-safe: sender_display can be "You"
    const { error } = await sb.from("deal_portal_chat_messages").insert({
      deal_id: dealId,
      sender_role: "borrower",
      sender_display: "You",
      body: text,
    });

    if (error) throw error;

    // Borrower-safe timeline ping
    await sb.from("deal_timeline_events").insert({
      deal_id: dealId,
      visibility: "banker",
      event_type: "BORROWER_MESSAGE",
      title: "Borrower sent a message",
      detail: text.slice(0, 200),
      meta: { kind: "chat" },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
