import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { emitBuddySignalServer } from "@/buddy/emitBuddySignalServer";
import { ingestDocument } from "@/lib/documents/ingestDocument";
import { isBorrowerUploadAllowed } from "@/lib/deals/lifecycleGuards";
import { recomputeDealReady } from "@/lib/deals/readiness";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { rateLimit } from "@/lib/portal/ratelimit";
import { recordReceipt } from "@/lib/portal/receipts";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
import {
  assertBoundedJsonContentLength,
  assertPreparedPortalUpload,
  MAX_PORTAL_UPLOAD_JSON_BYTES,
  parsePortalUploadCommitRequest,
  PortalUploadBoundaryError,
} from "@/lib/portal/uploadCommitBoundary";
import {
  downloadDocumentBytes,
  verifyDocumentContentIdentity,
} from "@/lib/storage/documentBytes";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordBorrowerUploadAndMaterialize } from "@/lib/uploads/recordBorrowerUploadAndMaterialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function unavailable(code: string): never {
  throw new PortalUploadBoundaryError(code, 503);
}

async function ensureDocumentJob(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  documentId: string,
) {
  const existing = await sb
    .from("document_jobs")
    .select("id, attachment_id, job_type, status")
    .eq("deal_id", dealId)
    .eq("attachment_id", documentId)
    .eq("job_type", "OCR")
    .limit(2);
  if (existing.error) unavailable("document_queue_unavailable");
  if ((existing.data ?? []).length > 1) unavailable("document_queue_ambiguous");
  if ((existing.data ?? []).length === 1) {
    const row = (existing.data ?? [])[0] as any;
    const status = String(row.status ?? "").toUpperCase();
    if (!status) unavailable("document_queue_unproven");
    if (["FAILED", "ERROR", "DEAD"].includes(status)) {
      const retried = await (sb as any)
        .from("document_jobs")
        .update({ status: "QUEUED", next_run_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("attachment_id", documentId)
        .eq("job_type", "OCR")
        .select("id, attachment_id, job_type, status")
        .maybeSingle();
      if (
        retried.error ||
        !retried.data?.id ||
        String(retried.data.status).toUpperCase() !== "QUEUED"
      ) {
        unavailable("document_queue_retry_unproven");
      }
    }
    return;
  }

  const queued = await (sb as any)
    .from("document_jobs")
    .insert({
      deal_id: dealId,
      attachment_id: documentId,
      job_type: "OCR",
      status: "QUEUED",
      next_run_at: new Date().toISOString(),
    })
    .select("id, attachment_id, job_type, status")
    .single();
  if (
    queued.error ||
    !queued.data?.id ||
    String(queued.data.attachment_id) !== documentId ||
    String(queued.data.job_type) !== "OCR"
  ) {
    unavailable("document_queue_unproven");
  }
}

export async function POST(req: Request) {
  let auditDealId: string | null = null;
  let auditBankId: string | null = null;

  try {
    assertBoundedJsonContentLength(req.headers.get("content-length"));
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_PORTAL_UPLOAD_JSON_BYTES) {
      throw new PortalUploadBoundaryError("request_too_large", 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new PortalUploadBoundaryError("invalid_json", 400);
    }
    const input = parsePortalUploadCommitRequest(
      body,
      req.headers.get("x-buddy-upload-session-id"),
    );

    const tokenKey = crypto.createHash("sha256").update(input.token).digest("hex").slice(0, 24);
    const rl = rateLimit(`portal:${tokenKey}:upload_commit`, 30, 60_000);
    if (!rl.ok) return json({ error: "rate_limited" }, 429);

    let invite;
    try {
      invite = await resolveBorrowerToken(input.token);
    } catch {
      return json({ error: "invalid_or_expired_link" }, 401);
    }
    auditDealId = invite.deal_id;
    auditBankId = invite.bank_id;

    const sb = supabaseAdmin();
    const dealResult = await sb
      .from("deals")
      .select("id, bank_id, stage, intake_phase")
      .eq("id", invite.deal_id)
      .maybeSingle();
    if (dealResult.error) unavailable("deal_state_unavailable");
    const deal = dealResult.data as any;
    if (!deal || String(deal.bank_id) !== String(invite.bank_id)) {
      throw new PortalUploadBoundaryError("deal_not_found", 404);
    }
    if (!isBorrowerUploadAllowed(deal.stage ?? null)) {
      throw new PortalUploadBoundaryError("borrower_upload_not_allowed", 403);
    }

    const sessionResult = await sb
      .from("deal_upload_sessions")
      .select("id, deal_id, bank_id, expires_at, status")
      .eq("id", input.uploadSessionId)
      .maybeSingle();
    if (sessionResult.error) unavailable("upload_session_state_unavailable");
    const session = sessionResult.data as any;
    const expiresAt = Date.parse(String(session?.expires_at ?? ""));
    if (
      !session ||
      String(session.deal_id) !== invite.deal_id ||
      String(session.bank_id) !== invite.bank_id ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      !["ready", "uploading", "completed"].includes(String(session.status))
    ) {
      throw new PortalUploadBoundaryError("invalid_upload_session", 409);
    }

    const fileResult = await sb
      .from("deal_upload_session_files")
      .select("id, session_id, deal_id, bank_id, file_id, filename, content_type, size_bytes, object_key, bucket, status")
      .eq("session_id", input.uploadSessionId)
      .eq("file_id", input.fileId)
      .eq("deal_id", invite.deal_id)
      .eq("bank_id", invite.bank_id)
      .maybeSingle();
    if (fileResult.error) unavailable("upload_session_file_state_unavailable");
    if (!fileResult.data?.id) {
      throw new PortalUploadBoundaryError("upload_session_file_missing", 409);
    }
    const prepared = assertPreparedPortalUpload({
      prepared: fileResult.data as any,
      request: input,
      dealId: invite.deal_id,
      bankId: invite.bank_id,
    });

    let storedBytes: Buffer;
    try {
      storedBytes = await downloadDocumentBytes({ bucket: prepared.bucket, path: prepared.path });
    } catch {
      unavailable("stored_upload_unavailable");
    }
    let identity: ReturnType<typeof verifyDocumentContentIdentity>;
    try {
      identity = verifyDocumentContentIdentity({
        bytes: storedBytes,
        expectedSizeBytes: prepared.sizeBytes,
      });
    } catch {
      throw new PortalUploadBoundaryError("stored_upload_identity_mismatch", 409);
    }

    await initializeIntake(invite.deal_id, invite.bank_id, { reason: "borrower_upload" });
    await logLedgerEvent({
      dealId: invite.deal_id,
      bankId: invite.bank_id,
      eventKey: "upload.process.start",
      uiState: "working",
      uiMessage: "Upload processing started",
      meta: { source: "borrower_portal", content_identity_verified: true },
    });

    const upload = await recordBorrowerUploadAndMaterialize({
      dealId: invite.deal_id,
      bankId: invite.bank_id,
      requestId: input.requestId,
      storageBucket: prepared.bucket,
      storagePath: prepared.path,
      originalFilename: prepared.filename,
      mimeType: prepared.mimeType,
      sizeBytes: identity.sizeBytes,
      source: "borrower_portal",
      materialize: false,
    });

    const canonical = await sb
      .from("deal_documents")
      .select("id, checklist_key, size_bytes, sha256, storage_bucket, storage_path")
      .eq("deal_id", invite.deal_id)
      .eq("bank_id", invite.bank_id)
      .eq("storage_bucket", prepared.bucket)
      .eq("storage_path", prepared.path)
      .limit(2);
    if (canonical.error) unavailable("document_state_unavailable");
    if ((canonical.data ?? []).length > 1) unavailable("document_state_ambiguous");

    let ingest: {
      documentId: string;
      checklistKey: string | null;
      matchReason: string | null;
    };
    const existingDocument = canonical.data?.[0] as any;
    if (existingDocument?.id) {
      if (Number(existingDocument.size_bytes) !== identity.sizeBytes) {
        throw new PortalUploadBoundaryError("canonical_document_identity_mismatch", 409);
      }
      if (existingDocument.sha256 && String(existingDocument.sha256) !== identity.sha256) {
        throw new PortalUploadBoundaryError("canonical_document_identity_mismatch", 409);
      }
      if (!existingDocument.sha256) {
        const repaired = await sb
          .from("deal_documents")
          .update({ sha256: identity.sha256, size_bytes: identity.sizeBytes })
          .eq("id", existingDocument.id)
          .eq("deal_id", invite.deal_id)
          .eq("bank_id", invite.bank_id)
          .select("id, sha256, size_bytes")
          .maybeSingle();
        if (
          repaired.error ||
          !repaired.data?.id ||
          String(repaired.data.sha256) !== identity.sha256 ||
          Number(repaired.data.size_bytes) !== identity.sizeBytes
        ) {
          unavailable("canonical_document_identity_unproven");
        }
      }
      ingest = {
        documentId: String(existingDocument.id),
        checklistKey: existingDocument.checklist_key ? String(existingDocument.checklist_key) : null,
        matchReason: "existing_verified_document",
      };
    } else {
      const created = await ingestDocument({
        dealId: invite.deal_id,
        bankId: invite.bank_id,
        file: {
          original_filename: prepared.filename,
          mimeType: prepared.mimeType,
          sizeBytes: identity.sizeBytes,
          storagePath: prepared.path,
          storageBucket: prepared.bucket,
          sha256: identity.sha256,
        },
        source: "borrower_portal",
        metadata: {
          task_checklist_key: input.taskKey,
          skip_filename_match: true,
          request_id: input.requestId,
          ...(input.spreadReviewActionId || input.spreadFindingKey || input.draftBorrowerRequestId
            ? {
                uploaded_for: "classic_spread_review_action",
                spread_review_action_id: input.spreadReviewActionId,
                spread_finding_key: input.spreadFindingKey,
                draft_borrower_request_id: input.draftBorrowerRequestId,
                requested_evidence_kind: input.requestedEvidenceKind,
              }
            : {}),
        },
      });
      if (!created.documentId) unavailable("canonical_document_unproven");
      ingest = {
        documentId: String(created.documentId),
        checklistKey: created.checklistKey ?? null,
        matchReason: created.matchReason ?? null,
      };
    }

    if (input.spreadReviewActionId || input.spreadFindingKey || input.draftBorrowerRequestId) {
      try {
        const { emitBuddyEvent } = await import("@/lib/observability/emitEvent");
        await emitBuddyEvent({
          event_type: "spread_evidence_uploaded",
          event_category: "flow",
          severity: "info",
          deal_id: invite.deal_id,
          bank_id: invite.bank_id,
          payload: {
            document_id: ingest.documentId,
            review_action_id: input.spreadReviewActionId,
            finding_key: input.spreadFindingKey,
            draft_request_id: input.draftBorrowerRequestId,
            requested_evidence_kind: input.requestedEvidenceKind,
            status: "uploaded",
          },
        });
      } catch {
        console.warn("[portal/upload/commit] spread upload signal unavailable", {
          code: "spread_upload_signal_unavailable",
        });
      }
    }

    if (input.requestId) {
      const requestProof = await sb
        .from("borrower_document_requests")
        .update({ status: "uploaded" })
        .eq("id", input.requestId)
        .eq("deal_id", invite.deal_id)
        .select("id, status")
        .maybeSingle();
      if (
        requestProof.error ||
        !requestProof.data?.id ||
        String(requestProof.data.status) !== "uploaded"
      ) {
        unavailable("borrower_request_update_unproven");
      }
    }

    const phaseResult = await sb
      .from("deals")
      .select("intake_phase")
      .eq("id", invite.deal_id)
      .eq("bank_id", invite.bank_id)
      .maybeSingle();
    if (phaseResult.error || !phaseResult.data) unavailable("intake_phase_unavailable");
    const uploadPhase = String((phaseResult.data as any).intake_phase ?? "");
    if (
      [
        "CONFIRMED_READY_FOR_PROCESSING",
        "PROCESSING",
        "PROCESSING_COMPLETE",
        "PROCESSING_COMPLETE_WITH_ERRORS",
      ].includes(uploadPhase)
    ) {
      await writeEvent({
        dealId: invite.deal_id,
        kind: "intake.upload_received_while_frozen",
        scope: "intake",
        meta: { source: "portal_commit", frozen_phase: uploadPhase, document_id: ingest.documentId },
      });
    } else {
      const { invalidateIntakeSnapshot } = await import(
        "@/lib/intake/confirmation/invalidateIntakeSnapshot"
      );
      await invalidateIntakeSnapshot(invite.deal_id, "portal_commit");
    }

    await writeEvent({
      dealId: invite.deal_id,
      kind: "deal.document.uploaded",
      actorUserId: null,
      input: {
        document_id: ingest.documentId,
        checklist_key: ingest.checklistKey,
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

    await ensureDocumentJob(sb, invite.deal_id, ingest.documentId);
    await recomputeDealReady(invite.deal_id);
    await recordReceipt({
      dealId: invite.deal_id,
      uploaderRole: "borrower",
      filename: prepared.filename,
      fileId: upload.uploadId,
      meta: { checklist_key: input.taskKey },
      skipFilenameMatch: true,
    });

    const fileProof = await sb
      .from("deal_upload_session_files")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", fileResult.data.id)
      .eq("session_id", input.uploadSessionId)
      .eq("file_id", input.fileId)
      .select("id, status")
      .maybeSingle();
    if (fileProof.error || !fileProof.data?.id || String(fileProof.data.status) !== "completed") {
      unavailable("upload_session_file_completion_unproven");
    }

    const [totalResult, completeResult] = await Promise.all([
      sb.from("deal_upload_session_files").select("id", { count: "exact", head: true }).eq("session_id", input.uploadSessionId),
      sb.from("deal_upload_session_files").select("id", { count: "exact", head: true }).eq("session_id", input.uploadSessionId).eq("status", "completed"),
    ]);
    if (
      totalResult.error ||
      completeResult.error ||
      !Number.isSafeInteger(totalResult.count) ||
      !Number.isSafeInteger(completeResult.count) ||
      Number(totalResult.count) <= 0
    ) {
      unavailable("upload_session_count_unavailable");
    }
    const nextStatus = totalResult.count === completeResult.count ? "completed" : "uploading";
    const sessionProof = await sb
      .from("deal_upload_sessions")
      .update({ status: nextStatus })
      .eq("id", input.uploadSessionId)
      .eq("deal_id", invite.deal_id)
      .eq("bank_id", invite.bank_id)
      .select("id, status")
      .maybeSingle();
    if (
      sessionProof.error ||
      !sessionProof.data?.id ||
      String(sessionProof.data.status) !== nextStatus
    ) {
      unavailable("upload_session_completion_unproven");
    }

    emitBuddySignalServer({
      type: "deal.document.uploaded",
      source: "api/portal/upload/commit",
      ts: Date.now(),
      dealId: invite.deal_id,
      payload: {
        document_id: ingest.documentId,
        checklist_key: ingest.checklistKey,
        source: "borrower_portal",
      },
    });
    await logLedgerEvent({
      dealId: invite.deal_id,
      bankId: invite.bank_id,
      eventKey: "upload.process.complete",
      uiState: "done",
      uiMessage: "Upload processing completed",
      meta: {
        source: "borrower_portal",
        content_identity_verified: true,
        document_persisted: true,
        processing_queued: true,
      },
    });

    return json({
      ok: true,
      uploadId: upload.uploadId,
      reconciled: upload.reconciled,
      checklistKey: ingest.checklistKey,
      matchReason: ingest.matchReason,
      uploadSessionId: input.uploadSessionId,
    });
  } catch (error) {
    const known = error instanceof PortalUploadBoundaryError;
    const status = known ? error.status : 503;
    const code = known ? error.code : "upload_commit_unavailable";
    console.error("[portal/upload/commit] processing incomplete", { code });
    if (auditDealId && auditBankId) {
      await logLedgerEvent({
        dealId: auditDealId,
        bankId: auditBankId,
        eventKey: "upload.process.failed",
        uiState: "done",
        uiMessage: "Upload processing incomplete",
        meta: { source: "borrower_portal", code },
      }).catch(() => undefined);
    }
    return json({ error: code }, status);
  }
}
