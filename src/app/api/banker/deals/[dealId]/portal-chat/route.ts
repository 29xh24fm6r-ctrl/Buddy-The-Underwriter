// src/app/api/banker/deals/[dealId]/portal-chat/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    requireUserId(req);
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;
    const { data, error } = await sb
      .from("deal_portal_chat_messages")
      .select("id, sender_role, sender_display, body, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true })
      .limit(500);

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
    const bankerUserId = requireUserId(req);
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;
    const body = await req.json();

    const text = String(body?.body ?? "").trim();
    if (!text) throw new Error("Message is empty.");

    const senderDisplay = String(body?.senderDisplay ?? "Bank Team");

    const { error } = await sb.from("deal_portal_chat_messages").insert({
      deal_id: dealId,
      sender_role: "banker",
      sender_display: senderDisplay,
      body: text,
    });

    if (error) throw error;

    // Borrower-visible timeline ping (safe)
    await sb.from("deal_timeline_events").insert({
      deal_id: dealId,
      visibility: "borrower",
      event_type: "BANK_MESSAGE",
      title: "Message from your bank",
      detail: "You have a new message in the portal.",
      meta: { kind: "chat" },
    });

    return NextResponse.json({ ok: true, bankerUserId });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
