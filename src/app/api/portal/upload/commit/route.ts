// src/app/api/portal/upload/commit/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import { rateLimit } from "@/lib/portal/ratelimit";
import { recordReceipt } from "@/lib/portal/receipts";
import { matchChecklistKeyFromFilename } from "@/lib/checklist/matchers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function tryEnqueueJobs(
  sb: ReturnType<typeof supabaseAdmin>,
  args: {
    dealId: string;
    bankId: string;
    uploadId: string;
    storageBucket: string;
    storagePath: string;
    filename: string;
  },
) {
  // Best-effort: only enqueue if table exists
  try {
    // Minimal job record shape (adjust later if your schema differs)
    await sb.from("document_jobs").insert({
      entity_type: "deal",
      entity_id: args.dealId,
      bank_id: args.bankId,
      job_type: "ocr",
      payload: {
        source: "borrower_portal",
        upload_id: args.uploadId,
        bucket: args.storageBucket,
        path: args.storagePath,
        filename: args.filename,
      },
    });

    await sb.from("document_jobs").insert({
      entity_type: "deal",
      entity_id: args.dealId,
      bank_id: args.bankId,
      job_type: "classify",
      payload: {
        source: "borrower_portal",
        upload_id: args.uploadId,
        bucket: args.storageBucket,
        path: args.storagePath,
        filename: args.filename,
      },
    });
  } catch {
    // swallow: don't block portal
  }
}

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  const token = body?.token;
  const requestId = body?.requestId || null;
  const path = body?.path;
  const filename = body?.filename;
  const mimeType = body?.mimeType || null;
  const sizeBytes = typeof body?.sizeBytes === "number" ? body.sizeBytes : null;

  if (!token || typeof token !== "string")
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  if (!path || typeof path !== "string")
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  if (!filename || typeof filename !== "string")
    return NextResponse.json({ error: "Missing filename" }, { status: 400 });

  const rl = rateLimit(
    `portal:${token.slice(0, 12)}:upload_commit`,
    30,
    60_000,
  );
  if (!rl.ok)
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  let invite;
  try {
    invite = await requireValidInvite(token);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Invalid/expired link" },
      { status: 401 },
    );
  }

  const { data: upload, error } = await sb
    .from("borrower_uploads")
    .insert({
      deal_id: invite.deal_id,
      bank_id: invite.bank_id,
      request_id: requestId,
      storage_bucket: "borrower_uploads",
      storage_path: path,
      original_filename: filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
    })
    .select("id")
    .single();

  if (error || !upload)
    return NextResponse.json(
      { error: "Failed to record upload" },
      { status: 500 },
    );

  if (requestId) {
    await sb
      .from("borrower_document_requests")
      .update({ status: "uploaded" })
      .eq("id", requestId);
  }

  // Kick off OCR/classify jobs (best-effort)
  await tryEnqueueJobs(sb, {
    dealId: invite.deal_id,
    bankId: invite.bank_id,
    uploadId: upload.id,
    storageBucket: "borrower_uploads",
    storagePath: path,
    filename,
  });

  // Auto-match checklist key from filename (borrower upload path)
  try {
    const match = matchChecklistKeyFromFilename(filename);
    if (match.matchedKey && match.confidence >= 0.6) {
      // Look up the deal_document record via borrower_uploads foreign key
      const { data: doc } = await sb
        .from("borrower_uploads")
        .select("deal_document_id")
        .eq("id", upload.id)
        .single();

      if (doc?.deal_document_id) {
        await sb
          .from("deal_documents")
          .update({ checklist_key: match.matchedKey })
          .eq("id", doc.deal_document_id);

        // Log to ledger
        await sb.from("deal_pipeline_ledger").insert({
          deal_id: invite.deal_id,
          bank_id: invite.bank_id,
          event_type: "checklist_auto_match",
          message: `Auto-matched ${filename} to ${match.matchedKey} (confidence: ${match.confidence})`,
          event_data: {
            source: "borrower_portal",
            upload_id: upload.id,
            document_id: doc.deal_document_id,
            filename,
            checklist_key: match.matchedKey,
            confidence: match.confidence,
            reason: match.reason,
          },
        });
      }
    }
  } catch (e) {
    console.error("Checklist auto-match failed (non-blocking):", e);
  }

  // Record receipt + auto-highlight checklist (best-effort)
  try {
    await recordReceipt({
      dealId: invite.deal_id,
      uploaderRole: "borrower",
      filename,
      fileId: upload.id,
      meta: { source: "portal_upload_commit" },
    });
  } catch {
    // swallow: don't block upload success
  }

  return NextResponse.json({ ok: true, uploadId: upload.id });
}
