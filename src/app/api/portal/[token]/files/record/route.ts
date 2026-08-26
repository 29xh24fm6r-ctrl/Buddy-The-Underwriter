import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { ingestDocument } from "@/lib/documents/ingestDocument";
import { recomputeDealReady } from "@/lib/deals/readiness";
import { recordBorrowerUploadAndMaterialize } from "@/lib/uploads/recordBorrowerUploadAndMaterialize";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { recordReceipt } from "@/lib/portal/receipts";
import { emitBuddySignalServer } from "@/buddy/emitBuddySignalServer";
import { isBorrowerUploadAllowed } from "@/lib/deals/lifecycleGuards";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { validateUploadSession } from "@/lib/uploads/uploadSession";
import { queueArtifact } from "@/lib/artifacts/queueArtifact";
import { deleteGcsObject, gcsObjectExists } from "@/lib/storage/gcs";
import { findExistingDocBySha } from "@/lib/storage/dedupe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ token: string }>;
};

async function completeUploadSessionFile(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  sessionId: string;
  sessionFileId: string;
  sizeBytes: number;
}): Promise<void> {
  const { error: fileError } = await args.sb
    .from("deal_upload_session_files")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      size_bytes: args.sizeBytes,
    })
    .eq("id", args.sessionFileId);

  if (fileError) throw new Error(`Unable to complete upload file: ${fileError.message}`);

  const [totalRes, completeRes] = await Promise.all([
    args.sb
      .from("deal_upload_session_files")
      .select("id", { count: "exact", head: true })
      .eq("session_id", args.sessionId),
    args.sb
      .from("deal_upload_session_files")
      .select("id", { count: "exact", head: true })
      .eq("session_id", args.sessionId)
      .eq("status", "completed"),
  ]);

  if (totalRes.error) throw new Error(`Unable to count upload files: ${totalRes.error.message}`);
  if (completeRes.error) throw new Error(`Unable to count completed uploads: ${completeRes.error.message}`);

  const status =
    (totalRes.count ?? 0) > 0 && totalRes.count === completeRes.count
      ? "completed"
      : "uploading";
  const { error: sessionError } = await args.sb
    .from("deal_upload_sessions")
    .update({ status })
    .eq("id", args.sessionId);
  if (sessionError) throw new Error(`Unable to update upload session: ${sessionError.message}`);
}

async function requireArtifactQueued(args: {
  dealId: string;
  bankId: string;
  documentId: string;
}): Promise<void> {
  const queued = await queueArtifact({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceTable: "deal_documents",
    sourceId: args.documentId,
  });
  if (!queued.ok) {
    throw new Error(
      `Unable to queue document ${args.documentId} for processing: ${queued.error ?? "unknown error"}`,
    );
  }
}

async function removeRedundantUpload(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  bucket: string;
  path: string;
}): Promise<void> {
  if (args.bucket === process.env.GCS_BUCKET) {
    await deleteGcsObject({ bucket: args.bucket, key: args.path });
    return;
  }
  const { error } = await args.sb.storage.from(args.bucket).remove([args.path]);
  if (error) throw new Error(`Unable to remove duplicate upload: ${error.message}`);
}

/**
 * POST /api/portal/[token]/files/record
 * 
 * Borrower portal version of file metadata recorder.
 * Authorization via portal token instead of Clerk auth.
 * Otherwise identical to banker endpoint.
 * 
 * Called AFTER client uploads bytes via signed URL.
 */
export async function POST(req: NextRequest, ctx: Context) {
  let dealIdForLog: string | null = null;
  let bankIdForLog: string | null = null;

  try {
    const { token } = await ctx.params;
    const body = await req.json();

    const {
      file_id,
      object_path,
      storage_path,
      storage_bucket,
      original_filename,
      mime_type,
      size_bytes,
      checklist_key = null,
      sha256,
      session_id,
      upload_session_id,
    } = body;

    const headerSessionId = req.headers.get("x-buddy-upload-session-id");
    const resolvedSessionId = headerSessionId || upload_session_id || session_id || null;

    // NOTE: reassigned below once the upload session's server-recorded
    // object_key/bucket is looked up — the client-submitted values are
    // never trusted for the actual write (see SECURITY comment below).
    let resolvedPath = storage_path || object_path;
    let resolvedBucket =
      storage_bucket || process.env.SUPABASE_UPLOAD_BUCKET || "deal-files";

    console.log("[UPLOAD RECORD ROUTE HIT - PORTAL]", {
      token,
      object_path: resolvedPath,
      original_filename,
      file_id,
      checklist_key,
      storage_bucket: resolvedBucket,
    });

    if (!file_id || !resolvedPath || !original_filename) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Verify token and get deal_id
    const sb = supabaseAdmin();

    // Canonical borrower auth — same resolver as the sign route and the
    // portal hub. Accepts a portal-link token, an invite token, or an exact
    // match against the authenticated borrower session, so self-serve
    // `/start` borrowers can record the file they just uploaded.
    let dealId: string;
    try {
      const ctx = await resolvePortalContext(token);
      dealId = ctx.dealId;
    } catch (error) {
      console.error("[portal/files/record] auth failed", {
        reason: (error as Error).message,
      });
      return NextResponse.json(
        { ok: false, error: "Invalid or expired link" },
        { status: 403 },
      );
    }

    // Fetch deal to get bank_id (required for insert)
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("bank_id, stage")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      console.error("[portal/files/record] deal not found", { dealId, dealErr });
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 },
      );
    }

    dealIdForLog = dealId;
    bankIdForLog = deal.bank_id;

    if (!resolvedSessionId) {
      await logLedgerEvent({
        dealId,
        bankId: deal.bank_id,
        eventKey: "upload.rejected",
        uiState: "done",
        uiMessage: "Upload rejected: missing session",
        meta: {
          file_id,
          upload_session_id: null,
          reason: "missing_upload_session",
          storage_path: resolvedPath,
          storage_bucket: resolvedBucket,
          source: "borrower_portal",
        },
      });
      return NextResponse.json(
        { ok: false, error: "Missing uploadSessionId" },
        { status: 400 },
      );
    }

    await initializeIntake(dealId, deal.bank_id, { reason: "borrower_upload" });

    const sessionValidation = await validateUploadSession({
      sb,
      sessionId: resolvedSessionId,
      dealId,
      bankId: deal.bank_id,
    });

    if (!sessionValidation.ok) {
      await logLedgerEvent({
        dealId,
        bankId: deal.bank_id,
        eventKey: "upload.rejected",
        uiState: "done",
        uiMessage: "Upload rejected: invalid session",
        meta: {
          file_id,
          upload_session_id: resolvedSessionId,
          reason: sessionValidation.error,
          storage_path: resolvedPath,
          storage_bucket: resolvedBucket,
          source: "borrower_portal",
        },
      });
      return NextResponse.json(
        { ok: false, error: sessionValidation.error },
        { status: 409 },
      );
    }

    await logLedgerEvent({
      dealId,
      bankId: deal.bank_id,
      eventKey: "upload.received",
      uiState: "done",
      uiMessage: "Upload received",
      meta: {
        file_id,
        upload_session_id: resolvedSessionId,
        storage_path: resolvedPath,
        storage_bucket: resolvedBucket,
        source: "borrower_portal",
      },
    });

    const existingFile = await sb
      .from("deal_upload_session_files")
      .select("id, size_bytes, object_key, bucket")
      .eq("session_id", resolvedSessionId)
      .eq("file_id", file_id)
      .maybeSingle();

    if (!existingFile.data?.id) {
      await logLedgerEvent({
        dealId,
        bankId: deal.bank_id,
        eventKey: "upload.rejected",
        uiState: "done",
        uiMessage: "Upload rejected: session file missing",
        meta: {
          file_id,
          upload_session_id: resolvedSessionId,
          reason: "upload_session_file_missing",
          storage_path: resolvedPath,
          storage_bucket: resolvedBucket,
          source: "borrower_portal",
        },
      });
      return NextResponse.json(
        { ok: false, error: "upload_session_file_missing" },
        { status: 409 },
      );
    }

    if (Number(existingFile.data?.size_bytes || 0) !== Number(size_bytes || 0)) {
      await logLedgerEvent({
        dealId,
        bankId: deal.bank_id,
        eventKey: "upload.rejected",
        uiState: "done",
        uiMessage: "Upload rejected: size mismatch",
        meta: {
          file_id,
          upload_session_id: resolvedSessionId,
          reason: "upload_session_size_mismatch",
          expected_size: Number(existingFile.data?.size_bytes || 0),
          received_size: Number(size_bytes || 0),
          storage_path: resolvedPath,
          storage_bucket: resolvedBucket,
          source: "borrower_portal",
        },
      });
      return NextResponse.json(
        { ok: false, error: "upload_session_size_mismatch" },
        { status: 409 },
      );
    }

    // SECURITY: never trust the client-submitted storage_path/storage_bucket.
    // Always resolve the object location from the server-recorded session-file
    // row (stamped when the signed URL was issued in /files/sign), so a
    // caller cannot point deal_documents at an arbitrary object it didn't
    // actually upload to.
    const sessionObjectKey = (existingFile.data as any).object_key as string | null;
    const sessionBucket = (existingFile.data as any).bucket as string | null;

    if (!sessionObjectKey || !sessionBucket) {
      await logLedgerEvent({
        dealId,
        bankId: deal.bank_id,
        eventKey: "upload.rejected",
        uiState: "done",
        uiMessage: "Upload rejected: session file missing object key",
        meta: {
          file_id,
          upload_session_id: resolvedSessionId,
          reason: "upload_session_object_key_missing",
          source: "borrower_portal",
        },
      });
      return NextResponse.json(
        { ok: false, error: "upload_session_object_key_missing" },
        { status: 409 },
      );
    }

    if (sessionObjectKey !== resolvedPath || sessionBucket !== resolvedBucket) {
      console.warn("[portal/files/record] client-submitted path differs from server-recorded session file; using server value", {
        dealId,
        fileId: file_id,
        uploadSessionId: resolvedSessionId,
        clientPath: resolvedPath,
        clientBucket: resolvedBucket,
        serverPath: sessionObjectKey,
        serverBucket: sessionBucket,
      });
    }

    resolvedPath = sessionObjectKey;
    resolvedBucket = sessionBucket;

    // The session remains uploading until storage verification, canonical
    // ingestion, and durable artifact queueing have all succeeded.

    const { data: refreshed } = await sb
      .from("deals")
      .select("stage")
      .eq("id", dealId)
      .maybeSingle();

    const stage = (refreshed as any)?.stage ?? deal.stage;
    if (!isBorrowerUploadAllowed(stage)) {
      return NextResponse.json(
        { ok: false, error: "Deal intake not started" },
        { status: 403 },
      );
    }

    // Verify file exists in storage.
    // GCS path: authoritative — reject if the object is confirmed absent.
    if (resolvedBucket === process.env.GCS_BUCKET) {
      const exists = await gcsObjectExists({ bucket: resolvedBucket, key: resolvedPath });
      if (!exists) {
        console.error("[portal/files/record] object not found in GCS", {
          object_path: resolvedPath,
        });
        return NextResponse.json(
          { ok: false, error: "File not found in storage" },
          { status: 404 },
        );
      }
    } else {
      const { data: fileExists, error: checkErr } = await sb.storage
        .from(resolvedBucket)
        .list(resolvedPath.split("/").slice(0, -1).join("/"), {
          search: resolvedPath.split("/").pop(),
        });

      if (checkErr || !fileExists || fileExists.length === 0) {
        console.error("[portal/files/record] file not found in storage", {
          object_path: resolvedPath,
          checkErr,
        });
        return NextResponse.json(
          { ok: false, error: "File not found in storage" },
          { status: 404 },
        );
      }
    }

    // Canonical ingestion: insert doc + stamp checklist + reconcile + log ledger
    await logLedgerEvent({
      dealId,
      bankId: deal.bank_id,
      eventKey: "upload.process.start",
      uiState: "working",
      uiMessage: "Upload processing started",
      meta: {
        file_id,
        upload_session_id: resolvedSessionId,
        storage_path: resolvedPath,
        storage_bucket: resolvedBucket,
        source: "borrower_portal",
      },
    });

    // CONTENT DE-DUPLICATION.
    //
    // The sign route already dedupes by sha256, but only when the client
    // sends one, and only at sign time — a borrower who re-uploads while an
    // earlier record is still in flight slips past it. Checking again here,
    // immediately before the insert, is the last point where a duplicate row
    // can still be prevented.
    //
    // Deal b296dec2 holds six identical copies of 2025_TaxReturn.pdf, every
    // one with sha256 NULL, because the borrower could not see what they had
    // already sent and kept re-sending it. The client now computes the hash
    // (see uploadBorrowerFile), so this check has something to match on.
    if (sha256) {
      const duplicate = await findExistingDocBySha({ sb, dealId, sha256 });
      if (duplicate) {
        await logLedgerEvent({
          dealId,
          bankId: deal.bank_id,
          eventKey: "upload.deduped",
          uiState: "done",
          uiMessage: "Already uploaded — kept the copy you sent earlier",
          meta: {
            file_id,
            existing_document_id: duplicate.id,
            sha256,
            source: "borrower_portal",
          },
        });
        // Ensure a previous partial attempt is durably queued before reporting
        // success. This also makes record retries self-healing.
        await requireArtifactQueued({
          dealId,
          bankId: deal.bank_id,
          documentId: duplicate.id,
        });

        if (
          duplicate.storage_bucket &&
          duplicate.storage_path &&
          (duplicate.storage_bucket !== resolvedBucket ||
            duplicate.storage_path !== resolvedPath)
        ) {
          await removeRedundantUpload({ sb, bucket: resolvedBucket, path: resolvedPath });
        }

        await completeUploadSessionFile({
          sb,
          sessionId: resolvedSessionId,
          sessionFileId: existingFile.data.id,
          sizeBytes: size_bytes ?? 0,
        });

        // Success, not an error: from the borrower's point of view the file
        // IS on the application. Returning a failure here would send them
        // right back into the re-upload loop this check exists to end.
        return NextResponse.json({
          ok: true,
          deduped: true,
          documentId: duplicate.id,
          document_id: duplicate.id,
        });
      }
    }

    const result = await ingestDocument({
      dealId,
      bankId: deal.bank_id,
      file: {
        original_filename,
        mimeType: mime_type ?? "application/octet-stream",
        sizeBytes: size_bytes ?? 0,
        storagePath: resolvedPath,
        storageBucket: resolvedBucket,
        sha256: sha256 ?? null,
      },
      source: "borrower_portal",
      metadata: { task_checklist_key: checklist_key, skip_filename_match: true },
    });

    // Phase E1: Invalidate snapshot if deal was already confirmed — but NEVER unseal a frozen deal.
    {
      const { data: phaseCheck } = await sb
        .from("deals")
        .select("intake_phase")
        .eq("id", dealId)
        .maybeSingle();

      const uploadPhase = (phaseCheck as any)?.intake_phase as string | null;

      if (
        uploadPhase &&
        ["CONFIRMED_READY_FOR_PROCESSING", "PROCESSING", "PROCESSING_COMPLETE", "PROCESSING_COMPLETE_WITH_ERRORS"].includes(uploadPhase)
      ) {
        void writeEvent({
          dealId,
          kind: "intake.upload_received_while_frozen",
          scope: "intake",
          meta: {
            source: "borrower_portal",
            frozen_phase: uploadPhase,
            document_id: result.documentId,
          },
        });
      } else {
        void import("@/lib/intake/confirmation/invalidateIntakeSnapshot")
          .then((m) => m.invalidateIntakeSnapshot(dealId, "borrower_portal"))
          .catch(() => {});
      }
    }

    await writeEvent({
      dealId,
      kind: "deal.document.uploaded",
      actorUserId: null,
      input: {
        document_id: result.documentId,
        checklist_key: result.checklistKey ?? null,
        source: "borrower_portal",
      },
    });

    if (result.checklistKey) {
      await writeEvent({
        dealId,
        kind: "deal.document.classified",
        actorUserId: null,
        input: {
          document_id: result.documentId,
          checklist_key: result.checklistKey,
          source: "borrower_task",
        },
      });
    }

    emitBuddySignalServer({
      type: "deal.document.uploaded",
      source: "api/portal/[token]/files/record",
      ts: Date.now(),
      dealId,
      payload: {
        document_id: result.documentId,
        checklist_key: result.checklistKey ?? null,
        source: "borrower_portal",
      },
    });

    // Classification is required operational work. Do not report the upload
    // complete until its durable artifact job exists.
    if (result.documentId) {
      await requireArtifactQueued({
        dealId,
        bankId: deal.bank_id,
        documentId: result.documentId,
      });
    }

    // Borrower-safe receipt + portal checklist highlight (hint-based)
    // This is intentionally separate from canonical checklist reconciliation.
    await recordReceipt({
      dealId,
      uploaderRole: "borrower",
      filename: original_filename,
      fileId: result.documentId,
      meta: {
        source: "borrower_portal",
        storage_path: object_path,
        checklist_key: checklist_key ?? null,
      },
      skipFilenameMatch: true,
    });

    // ✅ Audit trail: record borrower_uploads row for this upload (idempotent)
    await recordBorrowerUploadAndMaterialize({
      dealId,
      bankId: deal.bank_id,
      requestId: null,
      storageBucket: resolvedBucket,
      storagePath: resolvedPath,
      originalFilename: original_filename,
      mimeType: mime_type ?? "application/octet-stream",
      sizeBytes: size_bytes ?? 0,
      source: "borrower_portal",
      // This route already materializes via ingestDocument.
      materialize: false,
    });

    // 🧠 CONVERGENCE: Recompute deal readiness
    await recomputeDealReady(dealId);

    // Phase 12B: fire comms lifecycle hook — documents_received
    {
      const adminSb = supabaseAdmin();
      void import("@/lib/brokerage/commsLifecycleHooks")
        .then((m) => m.handleLifecycleHook({ dealId, event: "documents_received" }, adminSb))
        .catch(() => {});
    }

    // Emit ledger event (legacy - no actorUserId for borrower uploads)
    await writeEvent({
      dealId,
      actorUserId: null,
      kind: "document.uploaded",
      input: {
        file_id,
        original_filename,
        size_bytes,
        checklist_key,
        source: "borrower",
      },
    });

    await logLedgerEvent({
      dealId,
      bankId: deal.bank_id,
      eventKey: "documents.upload_completed",
      uiState: "done",
      uiMessage: `Upload completed (${resolvedBucket === process.env.GCS_BUCKET ? "gcs" : "supabase"})`,
      meta: {
        storage_bucket: resolvedBucket,
        storage_path: resolvedPath,
        size_bytes: size_bytes ?? null,
        sha256: sha256 ?? null,
        source: "borrower_portal",
      },
    });

    console.log("[portal/files/record] recorded borrower file", {
      dealId,
      file_id,
      original_filename,
      checklist_key,
    });

    await completeUploadSessionFile({
      sb,
      sessionId: resolvedSessionId,
      sessionFileId: existingFile.data.id,
      sizeBytes: size_bytes ?? 0,
    });

    await logLedgerEvent({
      dealId,
      bankId: deal.bank_id,
      eventKey: "upload.process.complete",
      uiState: "done",
      uiMessage: "Upload processing completed",
      meta: {
        file_id,
        upload_session_id: resolvedSessionId,
        document_id: result.documentId,
        storage_path: resolvedPath,
        storage_bucket: resolvedBucket,
        source: "borrower_portal",
      },
    });

    return NextResponse.json({ ok: true, file_id, ...result });
  } catch (error: any) {
    console.error("[portal/files/record] uncaught exception", {
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
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
