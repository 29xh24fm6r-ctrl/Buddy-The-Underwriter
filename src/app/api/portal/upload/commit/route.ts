// src/app/api/portal/upload/commit/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import { rateLimit } from "@/lib/portal/ratelimit";
import { recordReceipt } from "@/lib/portal/receipts";
import { recomputeDealReady } from "@/lib/deals/readiness";
import { recordBorrowerUploadAndMaterialize } from "@/lib/uploads/recordBorrowerUploadAndMaterialize";

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

  const upload = await recordBorrowerUploadAndMaterialize({
    dealId: invite.deal_id,
    bankId: invite.bank_id,
    requestId,
    storageBucket: "borrower_uploads",
    storagePath: path,
    originalFilename: filename,
    mimeType: mimeType ?? "application/octet-stream",
    sizeBytes: sizeBytes ?? 0,
    source: "borrower_portal",
    materialize: true,
  });

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
    uploadId: upload.uploadId,
    storageBucket: "borrower_uploads",
    storagePath: path,
    filename,
  });

  // 🧠 CONVERGENCE: Recompute deal readiness (best-effort)
  try {
    await recomputeDealReady(invite.deal_id);
  } catch (e) {
    console.error("Recompute readiness failed (non-blocking):", e);
  }

  // Record receipt + auto-highlight checklist (best-effort)
  try {
    await recordReceipt({
      dealId: invite.deal_id,
      uploaderRole: "borrower",
      filename,
      fileId: upload.uploadId,
      meta: { source: "portal_upload_commit" },
    });
  } catch {
    // swallow: don't block upload success
  }

  return NextResponse.json({ ok: true, uploadId: upload.uploadId, reconciled: upload.reconciled });
}
