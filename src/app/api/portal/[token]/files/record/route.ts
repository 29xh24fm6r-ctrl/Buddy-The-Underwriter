import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ token: string }>;
};

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

    const resolvedPath = storage_path || object_path;
    const resolvedBucket =
      storage_bucket || process.env.SUPABASE_UPLOAD_BUCKET || "deal-files";

    let dealIdForLog: string | null = null;
    let bankIdForLog: string | null = null;

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

    const { data: link, error: linkErr } = await sb
      .from("borrower_portal_links")
      .select("deal_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (linkErr || !link) {
      console.error("[portal/files/record] invalid token", { token, linkErr });
      return NextResponse.json(
        { ok: false, error: "Invalid or expired link" },
        { status: 403 },
      );
    }

    // Check expiration
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return NextResponse.json(
        { ok: false, error: "Link expired" },
        { status: 403 },
      );
    }

    const dealId = link.deal_id;

    // Fetch deal to get bank_id (required for insert)
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("bank_id, lifecycle_stage")
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
      .select("id, size_bytes")
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

    await sb
      .from("deal_upload_session_files")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        size_bytes: size_bytes ?? 0,
      })
      .eq("id", existingFile.data.id);

    const totalRes = await sb
      .from("deal_upload_session_files")
      .select("id", { count: "exact", head: true })
      .eq("session_id", resolvedSessionId);

    const completeRes = await sb
      .from("deal_upload_session_files")
      .select("id", { count: "exact", head: true })
      .eq("session_id", resolvedSessionId)
      .eq("status", "completed");

    const total = totalRes.count ?? 0;
    const completed = completeRes.count ?? 0;

    if (total > 0 && total === completed) {
      await sb
        .from("deal_upload_sessions")
        .update({ status: "completed" })
        .eq("id", resolvedSessionId);
    } else {
      await sb
        .from("deal_upload_sessions")
        .update({ status: "uploading" })
        .eq("id", resolvedSessionId);
    }

    const { data: refreshed } = await sb
      .from("deals")
      .select("lifecycle_stage")
      .eq("id", dealId)
      .maybeSingle();

    const stage = (refreshed as any)?.lifecycle_stage ?? deal.lifecycle_stage;
    if (!isBorrowerUploadAllowed(stage)) {
      return NextResponse.json(
        { ok: false, error: "Deal intake not started" },
        { status: 403 },
      );
    }

    // Verify file exists in storage (optional but recommended)
    if (resolvedBucket !== process.env.GCS_BUCKET) {
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

    // Phase E1: Invalidate snapshot if deal was already confirmed
    void import("@/lib/intake/confirmation/invalidateIntakeSnapshot")
      .then((m) => m.invalidateIntakeSnapshot(dealId, "borrower_portal"))
      .catch(() => {});

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

    // Queue for Magic Intake classification (non-blocking)
    if (result.documentId) {
      queueArtifact({
        dealId,
        bankId: deal.bank_id,
        sourceTable: "deal_documents",
        sourceId: result.documentId,
      }).catch((err) => {
        console.warn("[portal/files/record] queueArtifact failed (non-fatal)", {
          documentId: result.documentId,
          error: err?.message,
        });
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
