// src/app/api/deals/[dealId]/portal/requests/create-from-upload/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealHint, upsertBankPrior } from "@/lib/portal/learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  uploadId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  dueAt?: string | null;
  actorName?: string | null;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const body = (await req.json().catch(() => null)) as Body | null;

  if (!body?.uploadId || typeof body.uploadId !== "string") {
    return NextResponse.json({ error: "Missing uploadId" }, { status: 400 });
  }
  if (!body?.title || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "Missing title" }, { status: 400 });
  }

  const actorName =
    typeof body.actorName === "string" && body.actorName.trim()
      ? body.actorName.trim()
      : "Lending Team";

  const { data: upload, error: upErr } = await sb
    .from("borrower_uploads")
    .select(
      "id,deal_id,bank_id,request_id,original_filename,storage_path,storage_bucket,mime_type,file_key,classified_doc_type,extracted_year,ocr_text",
    )
    .eq("id", body.uploadId)
    .single();

  if (upErr || !upload)
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  if (upload.deal_id !== dealId)
    return NextResponse.json({ error: "Upload not in deal" }, { status: 400 });

  const category =
    typeof body.category === "string" ? body.category.trim() : null;

  // Ad-hoc requests don't have template_id
  const { data: reqRow, error: createErr } = await sb
    .from("borrower_document_requests")
    .insert({
      deal_id: dealId,
      bank_id: upload.bank_id,
      title: body.title.trim(),
      description:
        typeof body.description === "string" ? body.description.trim() : null,
      category: category,
      status: "uploaded",
      due_at: body.dueAt ?? null,
    })
    .select("id,title")
    .single();

  if (createErr || !reqRow)
    return NextResponse.json(
      { error: "Failed to create request" },
      { status: 500 },
    );

  const { error: assignErr } = await sb
    .from("borrower_uploads")
    .update({ request_id: reqRow.id })
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
        request_id: reqRow.id,
        deal_id: dealId,
        bank_id: upload.bank_id,
        confidence: 1,
        method: "manual",
        evidence: {
          hits: ["created_request_from_upload"],
          actor: actorName,
          filename: upload.original_filename,
        },
      },
      { onConflict: "upload_id,request_id" },
    )
    .then(() => null);

  sb.from("borrower_upload_events")
    .insert({
      upload_id: upload.id,
      deal_id: dealId,
      bank_id: upload.bank_id,
      type: "matched",
      payload: {
        request_id: reqRow.id,
        method: "manual",
        actor: actorName,
        created_request: true,
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
      title: "Created request from upload",
      body: `Created request "${reqRow.title}" and assigned "${upload.original_filename}".`,
      data: {
        upload_id: upload.id,
        request_id: reqRow.id,
        created_request: true,
      },
    })
    .then(() => null);

  // ✅ Learning loop: deal + bank priors (no template_id for ad-hoc requests)
  await upsertDealHint(sb, {
    dealId,
    bankId: upload.bank_id,
    requestId: reqRow.id,
    upload,
  }).catch(() => null);
  await upsertBankPrior(sb, {
    bankId: upload.bank_id,
    templateId: null, // Ad-hoc requests use label-based learning
    requestTitle: body.title.trim(),
    requestCategory: category,
    upload,
  }).catch(() => null);

  return NextResponse.json({ ok: true, requestId: reqRow.id });
}
