import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordLearningEvent } from "@/lib/packs/recordLearningEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  try {
    const body = await req.json();
    const upload_inbox_id = String(body?.upload_inbox_id || "");
    const request_id = String(body?.request_id || "");

    if (!upload_inbox_id || !request_id) {
      return NextResponse.json(
        { ok: false, error: "missing_params" },
        { status: 400 },
      );
    }

    // Load inbox upload
    const inboxRes = await sb
      .from("borrower_upload_inbox")
      .select(
        "id, bank_id, deal_id, filename, mime, bytes, storage_path, match_confidence, match_reason",
      )
      .eq("id", upload_inbox_id)
      .single();

    if (inboxRes.error || !inboxRes.data) {
      return NextResponse.json(
        { ok: false, error: inboxRes.error?.message || "upload_not_found" },
        { status: 404 },
      );
    }

    if (String(inboxRes.data.deal_id) !== String(dealId)) {
      return NextResponse.json(
        { ok: false, error: "deal_mismatch" },
        { status: 400 },
      );
    }

    const bank_id = inboxRes.data.bank_id;
    const filename = inboxRes.data.filename;
    const mime = inboxRes.data.mime;
    const path = inboxRes.data.storage_path;

    const now = new Date().toISOString();

    // Mark request received (manual attach)
    const updReq = await sb
      .from("borrower_document_requests")
      .update({
        status: "received",
        received_storage_path: path,
        received_filename: filename,
        received_mime: mime,
        received_at: now,
        updated_at: now,
        evidence: {
          manual_attached: true,
          source_upload_inbox_id: upload_inbox_id,
        },
      })
      .eq("id", request_id);

    if (updReq.error) throw new Error(updReq.error.message);

    // Update inbox
    const updInbox = await sb
      .from("borrower_upload_inbox")
      .update({
        matched_request_id: request_id,
        status: "attached",
      })
      .eq("id", upload_inbox_id);

    if (updInbox.error) throw new Error(updInbox.error.message);

    // Record pack match event as matched (manual)
    const matchEventIns = await sb
      .from("borrower_pack_match_events")
      .insert({
        bank_id,
        deal_id: dealId,
        upload_inbox_id,
        request_id,
        confidence: inboxRes.data.match_confidence ?? 0,
        matched: true,
      })
      .select("id")
      .single();

    if (matchEventIns.data?.id) {
      await recordLearningEvent(sb, {
        bankId: bank_id,
        matchEventId: matchEventIns.data.id,
        eventType: "banker_attached",
        metadata: {
          filename,
          request_id,
          upload_inbox_id,
          prior_confidence: inboxRes.data.match_confidence ?? null,
          prior_reason: inboxRes.data.match_reason ?? null,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "attach_failed" },
      { status: 400 },
    );
  }
}
