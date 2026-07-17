// src/app/api/portal/upload/commit/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
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
    // SPEC-BORROWER-EVIDENCE-UPLOAD-TO-BLOCKER-CLEARING-1: when a borrower uploads in response to a
    // classic-spread source-detail request, carry the linkage forward so the upload becomes LINKED
    // evidence for the exact review action. Optional + additive — absent for ordinary uploads.
    // SPEC-BORROWER-SPREAD-EVIDENCE-LAUNCH-HARDENING-1: normalize to a trimmed non-empty string or null
    // so empty/whitespace-only values never pollute deal_documents.metadata (the linker treats them as
    // "no linkage" → candidate, never linked; we keep the stored metadata equally clean).
    const linkStr = (v: unknown): string | null => {
      const s = typeof v === "string" ? v.trim() : "";
      return s.length > 0 ? s : null;
    };
    const spreadReviewActionId = linkStr(body?.spreadReviewActionId);
    const spreadFindingKey = linkStr(body?.spreadFindingKey);
    const draftBorrowerRequestId = linkStr(body?.draftBorrowerRequestId);
    const requestedEvidenceKind = linkStr(body?.requestedEvidenceKind);
    // A linked spread upload carries AT LEAST one tie-back key (action id, finding key, or draft id).
    const hasSpreadLinkage = Boolean(spreadReviewActionId || spreadFindingKey || draftBorrowerRequestId);
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
      // Accept a token from either borrower_invites or borrower_portal_links.
      invite = await resolveBorrowerToken(token);
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
      .select("stage")
      .eq("id", invite.deal_id)
      .maybeSingle();

    if (!isBorrowerUploadAllowed(deal?.stage ?? null)) {
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

    // NOTE: the session-file row is created at `prepare` time with a
    // placeholder `size_bytes: 0` (the real size isn't known until the
    // client finishes the direct-to-storage PUT). It is never updated
    // between prepare and commit, so comparing it against the
    // client-reported `sizeBytes` here always mismatches for any
    // non-empty file — that used to reject every real upload with a 409.
    // Session-file existence (checked above) plus a valid signed-upload
    // session already authorizes this write, so we just persist the
    // real size the client reports rather than "verifying" it against
    // a placeholder that was never meant to hold a real value.

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
        // Spread source-detail linkage (only present when the upload answers a spread review action).
        ...(hasSpreadLinkage
          ? {
              uploaded_for: "classic_spread_review_action",
              spread_review_action_id: spreadReviewActionId,
              spread_finding_key: spreadFindingKey,
              draft_borrower_request_id: draftBorrowerRequestId,
              requested_evidence_kind: requestedEvidenceKind,
            }
          : {}),
      },
    });

    // SPEC-BORROWER-EVIDENCE-UPLOAD-TO-BLOCKER-CLEARING-1: non-invasive ledger event when a borrower
    // upload is linked to a spread review action (status only — never clears the blocker).
    // SPEC-BORROWER-SPREAD-EVIDENCE-LAUNCH-HARDENING-1: fire for ANY tie-back (including draft-only
    // linkage, which still round-trips to LINKED evidence) and record which linkage keys were present
    // so a production "why didn't my upload link?" question is debuggable from the event alone.
    if (hasSpreadLinkage) {
      try {
        const { emitBuddyEvent } = await import("@/lib/observability/emitEvent");
        await emitBuddyEvent({
          event_type: "spread_evidence_uploaded",
          event_category: "flow",
          severity: "info",
          deal_id: invite.deal_id,
          bank_id: invite.bank_id,
          payload: {
            document_id: ingest.documentId ?? null,
            review_action_id: spreadReviewActionId,
            finding_key: spreadFindingKey,
            draft_request_id: draftBorrowerRequestId,
            requested_evidence_kind: requestedEvidenceKind,
            // Debug aid: the exact linkage keys carried (a draft-only upload still links via the draft).
            linkage: {
              has_review_action_id: Boolean(spreadReviewActionId),
              has_finding_key: Boolean(spreadFindingKey),
              has_draft_request_id: Boolean(draftBorrowerRequestId),
            },
            status: "uploaded",
          },
        }).catch(() => {});
      } catch { /* non-fatal */ }
    }

    // Phase E1: Invalidate snapshot if deal was already confirmed — but NEVER unseal a frozen deal.
    {
      const { data: phaseCheck } = await sb
        .from("deals")
        .select("intake_phase")
        .eq("id", invite.deal_id)
        .maybeSingle();

      const uploadPhase = (phaseCheck as any)?.intake_phase as string | null;

      if (
        uploadPhase &&
        ["CONFIRMED_READY_FOR_PROCESSING", "PROCESSING", "PROCESSING_COMPLETE", "PROCESSING_COMPLETE_WITH_ERRORS"].includes(uploadPhase)
      ) {
        void writeEvent({
          dealId: invite.deal_id,
          kind: "intake.upload_received_while_frozen",
          scope: "intake",
          meta: {
            source: "portal_commit",
            frozen_phase: uploadPhase,
            document_id: ingest.documentId,
          },
        });
      } else {
        void import("@/lib/intake/confirmation/invalidateIntakeSnapshot")
          .then((m) => m.invalidateIntakeSnapshot(invite.deal_id, "portal_commit"))
          .catch(() => {});
      }
    }

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
