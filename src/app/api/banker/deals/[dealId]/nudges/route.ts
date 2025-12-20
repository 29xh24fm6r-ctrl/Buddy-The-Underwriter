// src/app/api/banker/deals/[dealId]/nudges/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendDealMessage } from "@/lib/deals/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const bankerUserId = requireUserId(req);
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;

    const { data, error } = await sb
      .from("deal_message_drafts")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;
    return NextResponse.json({ ok: true, bankerUserId, drafts: data ?? [] });
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

    // actions:
    // { action: "approve_send", draftId }
    // { action: "update_body", draftId, body }
    const action = String(body?.action ?? "");
    const draftId = String(body?.draftId ?? "");
    if (!draftId) throw new Error("Missing draftId.");

    if (action === "update_body") {
      const newBody = String(body?.body ?? "").trim();
      if (!newBody) throw new Error("Body cannot be empty.");

      const { error } = await sb
        .from("deal_message_drafts")
        .update({ body: newBody })
        .eq("id", draftId)
        .eq("deal_id", dealId)
        .eq("status", "draft");

      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "approve_send") {
      // Mark approved (idempotent-ish)
      const { data: draft, error: dErr } = await sb
        .from("deal_message_drafts")
        .select("*")
        .eq("id", draftId)
        .eq("deal_id", dealId)
        .maybeSingle();

      if (dErr) throw dErr;
      if (!draft) throw new Error("Draft not found.");
      if (draft.status === "sent") return NextResponse.json({ ok: true, alreadySent: true });

      // Approve if draft
      if (draft.status === "draft") {
        const { error: aErr } = await sb
          .from("deal_message_drafts")
          .update({ status: "approved", approved_by: bankerUserId, approved_at: new Date().toISOString() })
          .eq("id", draftId)
          .eq("deal_id", dealId);

        if (aErr) throw aErr;
      }

      // Send via deal chat system (borrower-visible)
      await sendDealMessage({
        dealId,
        senderRole: "banker",
        senderUserId: bankerUserId,
        senderDisplay: "Bank",
        body: String(draft.body ?? "").trim(),
      });

      // Mark sent
      const { error: sErr } = await sb
        .from("deal_message_drafts")
        .update({ status: "sent", sent_by: bankerUserId, sent_at: new Date().toISOString() })
        .eq("id", draftId)
        .eq("deal_id", dealId);

      if (sErr) throw sErr;

      return NextResponse.json({ ok: true, sent: true });
    }

    throw new Error("Invalid action. Use update_body or approve_send.");
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
