// src/app/api/portal/upload/commit/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import { rateLimit } from "@/lib/portal/ratelimit";
import { recordReceipt } from "@/lib/portal/receipts";
import { recomputeDealReady } from "@/lib/deals/readiness";
import { recordBorrowerUploadAndMaterialize } from "@/lib/uploads/recordBorrowerUploadAndMaterialize";
import { isBorrowerUploadAllowed } from "@/lib/deals/lifecycleGuards";
import { ingestDocument } from "@/lib/documents/ingestDocument";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { emitBuddySignalServer } from "@/buddy/emitBuddySignalServer";

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
  // Best-effort: enqueue OCR against the canonical deal_documents row.
  // This enables OCR/text-based identification (e.g. Form 1120 for tax year 2023).
  try {
    const { data: doc } = await sb
      .from("deal_documents")
      .select("id")
      .eq("deal_id", args.dealId)
      .eq("storage_path", args.storagePath)
      .maybeSingle();

    const attachmentId = doc?.id ? String(doc.id) : null;
    if (!attachmentId) return;

    await (sb as any)
      .from("document_jobs")
      .upsert(
        {
          deal_id: args.dealId,
          attachment_id: attachmentId,
          job_type: "OCR",
          status: "QUEUED",
          next_run_at: new Date().toISOString(),
        },
        { onConflict: "attachment_id,job_type", ignoreDuplicates: true },
      );
  } catch {
    // swallow: don't block portal
  }
}

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  const token = body?.token;
  const requestId = body?.requestId || null;
  const taskKey = typeof body?.taskKey === "string" ? body.taskKey : null;
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

  const { data: deal } = await sb
    .from("deals")
    .select("lifecycle_stage")
    .eq("id", invite.deal_id)
    .maybeSingle();

  if (!isBorrowerUploadAllowed(deal?.lifecycle_stage ?? null)) {
    return NextResponse.json(
      { error: "Deal intake not started" },
      { status: 403 },
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
    materialize: false,
  });

  const ingest = await ingestDocument({
    dealId: invite.deal_id,
    bankId: invite.bank_id,
    file: {
      original_filename: filename,
      mimeType: mimeType ?? "application/octet-stream",
      sizeBytes: sizeBytes ?? 0,
      storagePath: path,
      storageBucket: "borrower_uploads",
    },
    source: "borrower_portal",
    metadata: {
      task_checklist_key: taskKey,
      skip_filename_match: true,
      request_id: requestId,
    },
  });

  await writeEvent({
    dealId: invite.deal_id,
    kind: "deal.document.uploaded",
    actorUserId: null,
    input: {
      document_id: ingest.documentId,
      checklist_key: ingest.checklistKey ?? null,
      source: "borrower_portal",
    },
  });

  if (ingest.checklistKey) {
    await writeEvent({
      dealId: invite.deal_id,
      kind: "deal.document.classified",
      actorUserId: null,
      input: {
        document_id: ingest.documentId,
        checklist_key: ingest.checklistKey,
        source: "borrower_task",
      },
    });
  }

  emitBuddySignalServer({
    type: "deal.document.uploaded",
    source: "api/portal/upload/commit",
    ts: Date.now(),
    dealId: invite.deal_id,
    payload: {
      document_id: ingest.documentId,
      checklist_key: ingest.checklistKey ?? null,
      source: "borrower_portal",
    },
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
      meta: { source: "portal_upload_commit", task_key: taskKey },
      skipFilenameMatch: true,
    });
  } catch {
    // swallow: don't block upload success
  }

  return NextResponse.json({
    ok: true,
    uploadId: upload.uploadId,
    reconciled: upload.reconciled,
    checklistKey: ingest.checklistKey ?? null,
    matchReason: ingest.matchReason ?? null,
  });
}
