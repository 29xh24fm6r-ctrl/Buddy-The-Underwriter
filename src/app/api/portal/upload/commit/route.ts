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
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { validateUploadSession } from "@/lib/uploads/uploadSession";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import crypto from "node:crypto";

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
  let dealIdForLog: string | null = null;
  let bankIdForLog: string | null = null;

  try {
    const sb = supabaseAdmin();
    const body = await req.json().catch(() => ({}));

    const token = body?.token;
    const requestId = body?.requestId || null;
    const taskKey = typeof body?.taskKey === "string" ? body.taskKey : null;
    const path = body?.path;
    const filename = body?.filename;
    const mimeType = body?.mimeType || null;
    const sizeBytes = typeof body?.sizeBytes === "number" ? body.sizeBytes : null;
    const fileId = body?.fileId || body?.file_id || null;
    const headerSessionId = req.headers.get("x-buddy-upload-session-id");
    const uploadSessionId =
      headerSessionId ||
      body?.uploadSessionId ||
      body?.upload_session_id ||
      body?.session_id ||
      null;

    if (!token || typeof token !== "string")
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    if (!path || typeof path !== "string")
      return NextResponse.json({ error: "Missing path" }, { status: 400 });
    if (!filename || typeof filename !== "string")
      return NextResponse.json({ error: "Missing filename" }, { status: 400 });
    if (!uploadSessionId || typeof uploadSessionId !== "string")
      return NextResponse.json({ error: "Missing uploadSessionId" }, { status: 400 });

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

    dealIdForLog = invite.deal_id;
    bankIdForLog = invite.bank_id;

    await initializeIntake(invite.deal_id, invite.bank_id, { reason: "borrower_upload" });

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

    const sessionValidation = await validateUploadSession({
      sb,
      sessionId: uploadSessionId,
      dealId: invite.deal_id,
      bankId: invite.bank_id,
    });

    if (!sessionValidation.ok) {
      await logLedgerEvent({
        dealId: invite.deal_id,
        bankId: invite.bank_id,
        eventKey: "upload.rejected",
        uiState: "done",
        uiMessage: "Upload rejected: invalid session",
        meta: {
          file_id: fileId,
          upload_session_id: uploadSessionId,
          reason: sessionValidation.error,
          storage_path: path,
          storage_bucket: "borrower_uploads",
          source: "borrower_portal",
        },
      });
      return NextResponse.json(
        { error: sessionValidation.error },
        { status: 409 },
      );
    }

    await logLedgerEvent({
      dealId: invite.deal_id,
      bankId: invite.bank_id,
      eventKey: "upload.received",
      uiState: "done",
      uiMessage: "Upload received",
      meta: {
        file_id: fileId,
        upload_session_id: uploadSessionId,
        storage_path: path,
        storage_bucket: "borrower_uploads",
        source: "borrower_portal",
      },
    });

    const resolvedFileId = typeof fileId === "string" && fileId ? fileId : crypto.randomUUID();

    const existingFile = await sb
      .from("deal_upload_session_files")
      .select("id, size_bytes")
      .eq("session_id", uploadSessionId)
      .eq("file_id", resolvedFileId)
      .maybeSingle();

    if (!existingFile.data?.id) {
      await logLedgerEvent({
        dealId: invite.deal_id,
        bankId: invite.bank_id,
        eventKey: "upload.rejected",
        uiState: "done",
        uiMessage: "Upload rejected: session file missing",
        meta: {
          file_id: resolvedFileId,
          upload_session_id: uploadSessionId,
          reason: "upload_session_file_missing",
          storage_path: path,
          storage_bucket: "borrower_uploads",
          source: "borrower_portal",
        },
      });
      return NextResponse.json(
        { error: "upload_session_file_missing" },
        { status: 409 },
      );
    }

    if (Number(existingFile.data?.size_bytes || 0) !== Number(sizeBytes || 0)) {
      await logLedgerEvent({
        dealId: invite.deal_id,
        bankId: invite.bank_id,
        eventKey: "upload.rejected",
        uiState: "done",
        uiMessage: "Upload rejected: size mismatch",
        meta: {
          file_id: resolvedFileId,
          upload_session_id: uploadSessionId,
          reason: "upload_session_size_mismatch",
          expected_size: Number(existingFile.data?.size_bytes || 0),
          received_size: Number(sizeBytes || 0),
          storage_path: path,
          storage_bucket: "borrower_uploads",
          source: "borrower_portal",
        },
      });
      return NextResponse.json(
        { error: "upload_session_size_mismatch" },
        { status: 409 },
      );
    }

    await sb
      .from("deal_upload_session_files")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        size_bytes: sizeBytes ?? 0,
      })
      .eq("id", existingFile.data.id);

    const totalRes = await sb
      .from("deal_upload_session_files")
      .select("id", { count: "exact", head: true })
      .eq("session_id", uploadSessionId);

    const completeRes = await sb
      .from("deal_upload_session_files")
      .select("id", { count: "exact", head: true })
      .eq("session_id", uploadSessionId)
      .eq("status", "completed");

    const total = totalRes.count ?? 0;
    const completed = completeRes.count ?? 0;

    if (total > 0 && total === completed) {
      await sb
        .from("deal_upload_sessions")
        .update({ status: "completed" })
        .eq("id", uploadSessionId);
    } else {
      await sb
        .from("deal_upload_sessions")
        .update({ status: "uploading" })
        .eq("id", uploadSessionId);
    }

    await logLedgerEvent({
      dealId: invite.deal_id,
      bankId: invite.bank_id,
      eventKey: "upload.process.start",
      uiState: "working",
      uiMessage: "Upload processing started",
      meta: {
        file_id: resolvedFileId,
        upload_session_id: uploadSessionId,
        storage_path: path,
        storage_bucket: "borrower_uploads",
        source: "borrower_portal",
      },
    });

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

    // Phase E1: Invalidate snapshot if deal was already confirmed
    void import("@/lib/intake/confirmation/invalidateIntakeSnapshot")
      .then((m) => m.invalidateIntakeSnapshot(invite.deal_id, "portal_commit"))
      .catch(() => {});

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

    await logLedgerEvent({
      dealId: invite.deal_id,
      bankId: invite.bank_id,
      eventKey: "upload.process.complete",
      uiState: "done",
      uiMessage: "Upload processing completed",
      meta: {
        file_id: resolvedFileId,
        upload_session_id: uploadSessionId,
        document_id: ingest.documentId,
        storage_path: path,
        storage_bucket: "borrower_uploads",
        source: "borrower_portal",
      },
    });

    return NextResponse.json({
      ok: true,
      uploadId: upload.uploadId,
      reconciled: upload.reconciled,
      checklistKey: ingest.checklistKey ?? null,
      matchReason: ingest.matchReason ?? null,
      uploadSessionId,
    });
  } catch (error: any) {
    console.error("[portal/upload/commit] uncaught exception", {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
    });
    if (typeof dealIdForLog === "string" && typeof bankIdForLog === "string") {
      await logLedgerEvent({
        dealId: dealIdForLog,
        bankId: bankIdForLog,
        eventKey: "upload.process.failed",
        uiState: "done",
        uiMessage: "Upload processing failed",
        meta: { error: error?.message || String(error), source: "borrower_portal" },
      });
    }
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
