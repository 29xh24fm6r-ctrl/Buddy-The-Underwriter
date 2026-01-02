// src/app/api/deals/[dealId]/portal/uploads/assign/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealHint, upsertBankPrior } from "@/lib/portal/learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  uploadId: string;
  requestId: string;
  note?: string | null;
  actorName?: string | null;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.uploadId || !body?.requestId) {
    return NextResponse.json(
      { error: "Missing uploadId/requestId" },
      { status: 400 },
    );
  }

  const actorName =
    typeof body.actorName === "string" && body.actorName.trim()
      ? body.actorName.trim()
      : "Lending Team";

  const { data: upload, error: upErr } = await sb
    .from("borrower_uploads")
    .select(
      "id,deal_id,bank_id,request_id,original_filename,storage_bucket,storage_path,mime_type,file_key,classified_doc_type,extracted_year,ocr_text",
    )
    .eq("id", body.uploadId)
    .single();

  if (upErr || !upload)
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  if (upload.deal_id !== dealId)
    return NextResponse.json({ error: "Upload not in deal" }, { status: 400 });

  const { data: request, error: rqErr } = await sb
    .from("borrower_document_requests")
    .select("id,deal_id,bank_id,title,status,category,template_id")
    .eq("id", body.requestId)
    .single();

  if (rqErr || !request)
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (request.deal_id !== dealId)
    return NextResponse.json({ error: "Request not in deal" }, { status: 400 });

  if (upload.request_id === request.id) {
    // Already assigned - still update learning
    await upsertDealHint(sb, {
      dealId,
      bankId: upload.bank_id,
      requestId: request.id,
      upload,
    }).catch(() => null);
    await upsertBankPrior(sb, {
      bankId: upload.bank_id,
      templateId: request.template_id,
      requestTitle: request.title,
      requestCategory: request.category,
      upload,
    }).catch(() => null);
    return NextResponse.json({ ok: true, alreadyAssigned: true });
  }

  const { error: assignErr } = await sb
    .from("borrower_uploads")
    .update({ request_id: request.id })
    .eq("id", upload.id);
  if (assignErr)
    return NextResponse.json(
      { error: "Failed to assign upload" },
      { status: 500 },
    );

  sb.from("borrower_upload_matches")
    .upsert(
      {
        upload_id: upload.id,
        request_id: request.id,
        deal_id: dealId,
        bank_id: upload.bank_id,
        confidence: 1,
        method: "manual",
        evidence: {
          note: typeof body.note === "string" ? body.note : null,
          actor: actorName,
          filename: upload.original_filename,
        },
      },
      { onConflict: "upload_id,request_id" },
    )
    .then(() => null);

  if (request.status !== "accepted") {
    await sb
      .from("borrower_document_requests")
      .update({ status: "uploaded" })
      .eq("id", request.id);
  }

  sb.from("borrower_upload_events")
    .insert({
      upload_id: upload.id,
      deal_id: dealId,
      bank_id: upload.bank_id,
      type: "matched",
      payload: {
        request_id: request.id,
        method: "manual",
        actor: actorName,
        note: body.note ?? null,
      },
    })
    .then(() => null);

  sb.from("borrower_notifications")
    .insert({
      deal_id: dealId,
      bank_id: upload.bank_id,
      audience: "bank",
      channel: "in_app",
      type: "info",
      title: "Upload assigned",
      body: `Assigned "${upload.original_filename}" to request "${request.title}".`,
      data: { upload_id: upload.id, request_id: request.id, method: "manual" },
    })
    .then(() => null);

  // ✅ Learning loop: deal + bank priors with template_id support
  await upsertDealHint(sb, {
    dealId,
    bankId: upload.bank_id,
    requestId: request.id,
    upload,
  }).catch(() => null);
  await upsertBankPrior(sb, {
    bankId: upload.bank_id,
    templateId: request.template_id,
    requestTitle: request.title,
    requestCategory: request.category,
    upload,
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
