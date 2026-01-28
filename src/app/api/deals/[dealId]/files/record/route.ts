/**
 * POST /api/deals/[dealId]/files/record
 *
 * Records file metadata after successful direct upload to storage.
 *
 * SESSION-AUTHORITATIVE ARCHITECTURE:
 * When an upload session is verified, we DO NOT query the `deals` table.
 * The session was created atomically with the deal via deal_bootstrap_create,
 * so if the session exists with matching deal_id, the deal EXISTS on primary.
 * This eliminates replica lag issues entirely for the critical upload path.
 *
 * The deal lookup (with retry) only runs when session verification fails,
 * which should be rare in production.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { recomputeDealReady } from "@/lib/deals/readiness";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { reconcileChecklistForDeal } from "@/lib/checklist/engine";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { igniteDeal } from "@/lib/deals/igniteDeal";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { canTransitionIntakeState, type DealIntakeState } from "@/lib/deals/intakeState";
import { queueArtifact } from "@/lib/artifacts/queueArtifact";
import { getBaseUrl } from "@/lib/net/getBaseUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    ),
  ]);
}

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * POST /api/deals/[dealId]/files/record
 *
 * Records file metadata after successful direct upload to storage.
 * Called AFTER client uploads bytes via signed URL.
 *
 * Flow:
 * 1. Client uploads file to signed URL from /files/sign
 * 2. Client calls this endpoint with metadata
 * 3. We insert record into deal_documents table
 * 4. Emit ledger event (document.uploaded)
 * 5. Trigger checklist auto-resolution (if checklist_key provided)
 *
 * This endpoint handles METADATA ONLY, never file bytes.
 */
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const requestId = req.headers.get("x-request-id") || null;
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized", request_id: requestId },
        { status: 401 },
      );
    }

    const { dealId } = await ctx.params;

    // =====================================================================
    // INVARIANT: dealId must be provided
    // This is an early boundary check before any other processing.
    // =====================================================================
    if (!dealId) {
      return NextResponse.json(
        { ok: false, error: "missing_deal_id", request_id: requestId },
        { status: 400 },
      );
    }

    const bankId = await getCurrentBankId();
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

    console.log("[UPLOAD RECORD ROUTE HIT]", {
      dealId,
      object_path: resolvedPath,
      original_filename,
      file_id,
      checklist_key,
      storage_bucket: resolvedBucket,
      requestId,
    });

    if (!file_id || !resolvedPath || !original_filename) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields", request_id: requestId },
        { status: 400 },
      );
    }

    if (!resolvedSessionId) {
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "upload.rejected",
        uiState: "done",
        uiMessage: "Upload rejected: missing session",
        meta: {
          file_id,
          upload_session_id: null,
          reason: "missing_upload_session",
          storage_path: resolvedPath,
          storage_bucket: resolvedBucket,
        },
      });
      return NextResponse.json(
        { ok: false, error: "missing_upload_session", request_id: requestId },
        { status: 400 },
      );
    }

    // Verify deal exists (authorization already happened at /files/sign)
    const sb = supabaseAdmin();

    // ======================================================================
    // FIX: Verify upload session FIRST to handle replication lag
    // The session and deal are created atomically via deal_bootstrap_create,
    // so if session exists with matching deal_id, we can trust the deal exists
    // (even if read replica is slow to catch up)
    // ======================================================================

    let sessionVerified = false;
    let sessionData: {
      id: string;
      deal_id: string;
      bank_id: string;
      expires_at: string | null;
      status: string;
    } | null = null;

    if (resolvedSessionId) {
      const sessionCheck = await sb
        .from("deal_upload_sessions")
        .select("id, deal_id, bank_id, expires_at, status")
        .eq("id", resolvedSessionId)
        .maybeSingle();

      if (sessionCheck.data && String(sessionCheck.data.deal_id) === String(dealId)) {
        sessionVerified = true;
        sessionData = sessionCheck.data as any;
        console.log("[files/record] session verified, deal creation confirmed via atomic transaction", {
          dealId,
          sessionId: resolvedSessionId,
          sessionBankId: sessionCheck.data.bank_id,
        });
      } else if (sessionCheck.error) {
        console.warn("[files/record] session check failed", {
          sessionId: resolvedSessionId,
          error: sessionCheck.error.message
        });
      }
    }

    // ======================================================================
    // SESSION-AUTHORITATIVE ARCHITECTURE:
    // If session is verified, the deal EXISTS (created atomically on primary).
    // DO NOT read the `deals` table - skip replica dependencies entirely.
    // ======================================================================
    let deal: { id: string; bank_id: string | null; lifecycle_stage: string | null; intake_state?: string } | null = null;

    if (sessionVerified && sessionData) {
      // Session was created atomically with deal via deal_bootstrap_create.
      // The session's bank_id IS the deal's bank_id. Trust it.
      console.log("[files/record] session-authoritative: skipping deal lookup", {
        dealId,
        sessionId: resolvedSessionId,
        sessionBankId: sessionData.bank_id,
      });

      // Verify bank authorization using session's bank_id (not from deals table)
      const sessionBankId = String(sessionData.bank_id);
      if (sessionBankId !== bankId) {
        console.error("[files/record] session bank_id mismatch", { dealId, sessionBankId, userBankId: bankId });
        return NextResponse.json(
          { ok: false, error: "deal_bank_mismatch", dealBankId: sessionBankId, userBankId: bankId, request_id: requestId },
          { status: 404 },
        );
      }

      // Construct minimal deal object from session data (no replica read needed)
      deal = {
        id: dealId,
        bank_id: sessionBankId,
        lifecycle_stage: null, // Will be handled by igniteDeal if needed
        intake_state: undefined,
      };
    } else {
      // Session not verified - fall back to deal lookup with retry logic
      let dealErr: any = null;
      const maxAttempts = 4;
      const baseDelay = 500; // ms

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const result = await sb
          .from("deals")
          .select("id, bank_id, lifecycle_stage, intake_state")
          .eq("id", dealId)
          .maybeSingle();

        deal = result.data;
        dealErr = result.error;

        if (deal) {
          if (attempt > 1) {
            const totalWait = Array.from({length: attempt - 1}, (_, i) => baseDelay * (i + 1)).reduce((a, b) => a + b, 0);
            console.log("[files/record] deal found on retry", {
              dealId,
              attempt,
              totalWaitMs: totalWait
            });
          }
          break;
        }

        if (attempt < maxAttempts) {
          const delay = baseDelay * attempt; // Linear backoff: 500, 1000, 1500, 2000ms
          console.log("[files/record] deal not found, retrying...", {
            dealId,
            attempt,
            nextDelayMs: delay,
            maxAttempts,
          });
          await new Promise(r => setTimeout(r, delay));
        }
      }

      if (dealErr || !deal) {
        console.error("[files/record] deal not found in DB after retries", {
          dealId,
          dealErr: dealErr?.message,
          maxAttempts,
          requestId
        });

        return NextResponse.json(
          {
            ok: false,
            error: "deal_not_found_db",
            details: dealErr?.message,
            request_id: requestId
          },
          { status: 404 },
        );
      }

      const dealBankId = deal.bank_id ? String(deal.bank_id) : null;
      if (dealBankId && dealBankId !== bankId) {
        console.error("[files/record] bank_id mismatch", { dealId, dealBankId, userBankId: bankId });
        return NextResponse.json(
          { ok: false, error: "deal_bank_mismatch", dealBankId, userBankId: bankId, request_id: requestId },
          { status: 404 },
        );
      }

      if (!dealBankId) {
        const up = await sb
          .from("deals")
          .update({ bank_id: bankId })
          .eq("id", dealId);
        if (up.error) {
          console.warn("[files/record] failed to backfill bank_id", {
            dealId,
            bankId,
            error: up.error.message,
          });
        }
      }
    }

    await initializeIntake(dealId, bankId, { reason: "banker_upload" });

    if (!deal.lifecycle_stage || deal.lifecycle_stage === "created") {
      await igniteDeal({
        dealId,
        bankId,
        source: "banker_upload",
        triggeredByUserId: userId,
      });
    }

    await initializeIntake(dealId, bankId, { reason: "files_record", trigger: "files.record" });

    if (resolvedSessionId) {
      // Reuse cached sessionData if we already verified it, otherwise fetch fresh
      let session: {
        id: string;
        deal_id: string;
        bank_id: string;
        expires_at: string | null;
        status: string;
      } | null = sessionData;

      if (!session) {
        const sessionRes = await sb
          .from("deal_upload_sessions")
          .select("id, deal_id, bank_id, expires_at, status")
          .eq("id", resolvedSessionId)
          .maybeSingle();

        if (sessionRes.error || !sessionRes.data) {
          await logLedgerEvent({
            dealId,
            bankId,
            eventKey: "upload.rejected",
            uiState: "done",
            uiMessage: "Upload rejected: invalid session",
            meta: {
              file_id,
              upload_session_id: resolvedSessionId,
              reason: "invalid_upload_session",
              storage_path: resolvedPath,
              storage_bucket: resolvedBucket,
            },
          });
          return NextResponse.json(
            { ok: false, error: "invalid_upload_session", request_id: requestId },
            { status: 409 },
          );
        }
        session = sessionRes.data as any;
      }

      // At this point session is guaranteed to be non-null
      const validSession = session!;
      const expiresAt = validSession.expires_at ? new Date(validSession.expires_at) : null;
      const expired = expiresAt ? Date.now() > expiresAt.getTime() : false;
      if (expired || validSession.status === "failed" || validSession.status === "completed") {
        await logLedgerEvent({
          dealId,
          bankId,
          eventKey: "upload.rejected",
          uiState: "done",
          uiMessage: "Upload rejected: session expired",
          meta: {
            file_id,
            upload_session_id: resolvedSessionId,
            reason: "upload_session_expired",
            storage_path: resolvedPath,
            storage_bucket: resolvedBucket,
          },
        });
        return NextResponse.json(
          { ok: false, error: "upload_session_expired", request_id: requestId },
          { status: 409 },
        );
      }

      if (String(validSession.bank_id) !== String(bankId)) {
        await logLedgerEvent({
          dealId,
          bankId,
          eventKey: "upload.rejected",
          uiState: "done",
          uiMessage: "Upload rejected: bank mismatch",
          meta: {
            file_id,
            upload_session_id: resolvedSessionId,
            reason: "upload_session_bank_mismatch",
            storage_path: resolvedPath,
            storage_bucket: resolvedBucket,
          },
        });
        return NextResponse.json(
          { ok: false, error: "upload_session_bank_mismatch", request_id: requestId },
          { status: 409 },
        );
      }

      if (String(validSession.deal_id) !== String(dealId)) {
        await logLedgerEvent({
          dealId,
          bankId,
          eventKey: "upload.rejected",
          uiState: "done",
          uiMessage: "Upload rejected: deal mismatch",
          meta: {
            file_id,
            upload_session_id: resolvedSessionId,
            reason: "upload_session_mismatch",
            storage_path: resolvedPath,
            storage_bucket: resolvedBucket,
          },
        });
        return NextResponse.json(
          { ok: false, error: "upload_session_mismatch", request_id: requestId },
          { status: 409 },
        );
      }

      const fileRes = await sb
        .from("deal_upload_session_files")
        .select("id, size_bytes, status")
        .eq("session_id", resolvedSessionId)
        .eq("file_id", file_id)
        .maybeSingle();

      if (fileRes.error || !fileRes.data) {
        await logLedgerEvent({
          dealId,
          bankId,
          eventKey: "upload.rejected",
          uiState: "done",
          uiMessage: "Upload rejected: session file missing",
          meta: {
            file_id,
            upload_session_id: resolvedSessionId,
            reason: "upload_session_file_missing",
            storage_path: resolvedPath,
            storage_bucket: resolvedBucket,
          },
        });
        return NextResponse.json(
          { ok: false, error: "upload_session_file_missing", request_id: requestId },
          { status: 409 },
        );
      }

      const fileRow = fileRes.data as any;
      if (Number(fileRow.size_bytes || 0) !== Number(size_bytes || 0)) {
        await logLedgerEvent({
          dealId,
          bankId,
          eventKey: "upload.rejected",
          uiState: "done",
          uiMessage: "Upload rejected: size mismatch",
          meta: {
            file_id,
            upload_session_id: resolvedSessionId,
            reason: "upload_session_size_mismatch",
            expected_size: Number(fileRow.size_bytes || 0),
            received_size: Number(size_bytes || 0),
            storage_path: resolvedPath,
            storage_bucket: resolvedBucket,
          },
        });
        return NextResponse.json(
          { ok: false, error: "upload_session_size_mismatch", request_id: requestId },
          { status: 409 },
        );
      }

      if (fileRow.status !== "completed") {
        await sb
          .from("deal_upload_session_files")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", fileRow.id);
      }

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

      if (validSession.status === "ready") {
        await sb
          .from("deal_upload_sessions")
          .update({ status: "uploading" })
          .eq("id", resolvedSessionId);
      }

      if (total > 0 && total === completed) {
        await sb
          .from("deal_upload_sessions")
          .update({ status: "completed" })
          .eq("id", resolvedSessionId);

        const nextState: DealIntakeState = "UPLOAD_COMPLETE";
        if (canTransitionIntakeState((deal as any).intake_state || "CREATED", nextState)) {
          await sb
            .from("deals")
            .update({ intake_state: nextState })
            .eq("id", dealId);
        }
      } else {
        const nextState: DealIntakeState = "UPLOADING";
        if (canTransitionIntakeState((deal as any).intake_state || "CREATED", nextState)) {
          await sb
            .from("deals")
            .update({ intake_state: nextState })
            .eq("id", dealId);
        }
      }
    }

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "upload.received",
      uiState: "done",
      uiMessage: "Upload received",
      meta: {
        file_id,
        upload_session_id: resolvedSessionId,
        storage_path: resolvedPath,
        storage_bucket: resolvedBucket,
      },
    });

    // Verify file exists in storage (optional but recommended)
    // This MUST be best-effort and bounded; do not block the upload UX.
    let fileExists: any[] | null = null;
    let checkErr: any = null;
    try {
      if (resolvedBucket !== process.env.GCS_BUCKET) {
        const res = await withTimeout(
          sb.storage
            .from(resolvedBucket)
            .list(resolvedPath.split("/").slice(0, -1).join("/"), {
              search: resolvedPath.split("/").pop(),
            }),
          5_000,
          "storageList",
        );
        fileExists = (res as any)?.data ?? null;
        checkErr = (res as any)?.error ?? null;
      }
    } catch (e: any) {
      checkErr = e;
    }

    // Best-effort only: signed upload succeeded client-side, so we should still
    // materialize the canonical DB record even if list/search behaves oddly.
    if (checkErr) {
      console.warn("[files/record] storage check error (non-fatal)", {
        object_path: resolvedPath,
        checkErr,
      });
    } else if (resolvedBucket !== process.env.GCS_BUCKET) {
      if (!fileExists || fileExists.length === 0) {
        console.warn("[files/record] storage check did not find file (non-fatal)", {
          object_path: resolvedPath,
        });
      }
    }

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "upload.process.start",
      uiState: "working",
      uiMessage: "Upload processing started",
      meta: {
        file_id,
        upload_session_id: resolvedSessionId,
        storage_path: resolvedPath,
        storage_bucket: resolvedBucket,
      },
    });

    // ✅ 1) Materialize banker upload into canonical deal_documents (idempotent)
    const documentKey = `path:${resolvedPath}`.replace(/[^a-z0-9_:/-]/gi, "_");

    const doc = {
      deal_id: dealId,
      bank_id: bankId,
      original_filename,
      mime_type: mime_type ?? "application/octet-stream",
      size_bytes: size_bytes ?? 0,
      storage_bucket: resolvedBucket,
      storage_path: resolvedPath,
      sha256: sha256 ?? null,
      checklist_key: checklist_key ?? null,
      source: "internal",
      uploader_user_id: userId,
      document_key: documentKey,
      metadata: {
        ...(checklist_key ? { checklist_key } : {}),
        ...(sha256 ? { sha256 } : {}),
        committed_via: "banker_record_route",
      },
    };

    // Prefer true idempotency via unique index on (deal_id, storage_path).
    // But even if that index isn't applied yet, we still want the write path to work.
    const existing = await sb
      .from("deal_documents")
      .select("id, checklist_key")
      .eq("deal_id", dealId)
      .eq("storage_path", resolvedPath)
      .maybeSingle();

    let documentId: string | null = existing.data?.id ? String(existing.data.id) : null;

    // If we already have a record but it doesn't have checklist_key yet,
    // and the caller provided one, persist it deterministically.
    if (documentId && checklist_key && !existing.data?.checklist_key) {
      await sb
        .from("deal_documents")
        .update({ checklist_key })
        .eq("id", documentId);
    }

    if (!documentId) {
      const ins = await sb
        .from("deal_documents")
        .insert(doc as any)
        .select("id")
        .single();

      if (ins.error || !ins.data?.id) {
        // If the DB now has a unique constraint and we raced, try read-after-write.
        const reRead = await sb
          .from("deal_documents")
          .select("id")
          .eq("deal_id", dealId)
          .eq("storage_path", resolvedPath)
          .maybeSingle();

        documentId = reRead.data?.id ? String(reRead.data.id) : null;
        if (!documentId) {
          console.error("[files/record] deal_documents insert failed", ins.error);
          return NextResponse.json(
            {
              ok: false,
              error: "Failed to record document",
              details: ins.error?.message || ins.error,
              request_id: requestId,
            },
            { status: 500 },
          );
        }
      } else {
        documentId = String(ins.data.id);
      }
    }

    // ✅ 2) Reconcile checklist immediately (THIS flips received/pending)
    await reconcileChecklistForDeal({ sb, dealId });

    // ✅ 2.5) Queue for Magic Intake classification (non-blocking)
    if (documentId) {
      queueArtifact({
        dealId,
        bankId,
        sourceTable: "deal_documents",
        sourceId: documentId,
      }).catch((err) => {
        console.warn("[files/record] queueArtifact failed (non-fatal)", {
          documentId,
          error: err?.message,
        });
      });

      // Fire-and-forget: nudge artifact processor to drain queue
      const base = getBaseUrl();
      if (base) {
        fetch(`${base}/api/artifacts/process?max=3`, {
          method: "POST",
          headers: { "x-buddy-internal": "1" },
        }).catch(() => {});
      }
    }

    // ✅ 3) Pipeline ledger audit trail
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "upload_commit",
      uiState: "done",
      uiMessage: `Banker upload committed: ${original_filename}`,
      meta: {
        document_id: documentId,
        storage_bucket: resolvedBucket,
        storage_path: resolvedPath,
        original_filename,
        mime_type: mime_type ?? null,
        size_bytes: size_bytes ?? null,
        sha256: sha256 ?? null,
      },
    });

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "documents.upload_completed",
      uiState: "done",
      uiMessage: `Upload completed (${resolvedBucket === process.env.GCS_BUCKET ? "gcs" : "supabase"})`,
      meta: {
        document_id: documentId,
        provider: resolvedBucket === process.env.GCS_BUCKET ? "gcs" : "supabase",
        storage_bucket: resolvedBucket,
        storage_path: resolvedPath,
        size_bytes: size_bytes ?? null,
        sha256: sha256 ?? null,
      },
    });

    // 🧠 CONVERGENCE: Recompute deal readiness
    await recomputeDealReady(dealId);

    // Emit ledger event (legacy - can be removed after ledger consolidation)
    await writeEvent({
      dealId,
      actorUserId: userId,
      kind: "document.uploaded",
      input: {
        file_id,
        original_filename,
        size_bytes,
        checklist_key,
      },
    });

    console.log("[files/record] recorded file", {
      dealId,
      file_id,
      original_filename,
      checklist_key,
    });

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "upload.process.complete",
      uiState: "done",
      uiMessage: "Upload processing completed",
      meta: {
        file_id,
        upload_session_id: resolvedSessionId,
        document_id: documentId,
        storage_path: resolvedPath,
        storage_bucket: resolvedBucket,
      },
    });

    return NextResponse.json({
      ok: true,
      file_id,
      checklist_key: checklist_key || null,
      meta: { document_id: documentId },
    });
  } catch (error: any) {
    console.error("[files/record] uncaught exception", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    const requestId = req.headers.get("x-request-id") || null;
    const dealId = await ctx.params.then((p) => p.dealId).catch(() => null as any);
    const bankId = await getCurrentBankId().catch(() => null as any);
    if (dealId && bankId) {
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "upload.process.failed",
        uiState: "done",
        uiMessage: "Upload processing failed",
        meta: {
          error: error?.message || String(error),
          request_id: requestId,
        },
      });
    }
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Internal server error",
        details: error.message || String(error),
        request_id: req.headers.get("x-request-id") || null,
      },
      { status: 500 },
    );
  }
}
