/**
 * POST /api/artifacts/process
 *
 * Process queued document artifacts.
 * This endpoint can be called by:
 *   - Internal server-to-server (x-buddy-internal header)
 *   - Vercel cron (WORKER_SECRET via header/query/bearer)
 *   - Super admins (via UI)
 *
 * Query params:
 * - max: Maximum number of artifacts to process (default: 10, max: 50)
 */

import { NextRequest, NextResponse } from "next/server";
import { processBatch } from "@/lib/artifacts/processArtifact";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { sendHeartbeat, writeSystemEvent } from "@/lib/aegis";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max for processing

/** Check if the request is authorized via internal header or worker/cron secret. */
function isAuthorized(req: NextRequest): boolean {
  // Internal server-to-server call (same-origin, injected by upload route)
  if (req.headers.get("x-buddy-internal") === "1") return true;

  // Worker secret or Vercel CRON_SECRET
  return hasValidWorkerSecret(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    // Parse max from query or body
    const url = new URL(req.url);
    let max = parseInt(url.searchParams.get("max") || "10", 10);

    // Try to get from body too
    try {
      const body = await req.json().catch(() => ({}));
      if (body.max) {
        max = parseInt(body.max, 10);
      }
    } catch {
      // Ignore body parse errors
    }

    // Clamp max to reasonable limits
    max = Math.min(50, Math.max(1, max || 10));

    console.log("[artifacts/process] starting batch", { max });

    // Heartbeat is sent only after we know there was work to do (results.length > 0)
    // or after a failure is observed. Pure-idle invocations no longer write to
    // buddy_workers — that was the source of heartbeat-spam at idle cron rate.

    const startTime = Date.now();
    const results = await processBatch(max);
    const duration = Date.now() - startTime;

    if (results.length > 0) {
      sendHeartbeat({
        workerId: `artifact-processor-${process.pid}`,
        workerType: "artifact_processor",
      }).catch(() => {});
    }

    const summary = {
      processed: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      duration_ms: duration,
    };

    console.log("[artifacts/process] batch complete", summary);

    // Aegis: emit batch summary event
    if (summary.failed > 0) {
      writeSystemEvent({
        event_type: "warning",
        severity: "warning",
        source_system: "artifact_processor",
        error_message: `Artifact batch: ${summary.failed}/${summary.processed} failed`,
        resolution_status: "open",
        payload: summary,
      }).catch(() => {});
    }

    // === Belt-and-suspenders: trigger naming for all affected deals ===
    // processArtifact already calls runNamingDerivation per artifact, but if
    // any path returned early (stamp failed, manual override, etc.), naming
    // was missed. This catch-up triggers naming for every deal that had at
    // least one artifact processed in this batch.
    if (results.length > 0) {
      try {
        const sb = supabaseAdmin();
        const artifactIds = results
          .filter((r) => r.ok)
          .map((r) => r.artifactId);

        if (artifactIds.length > 0) {
          const { data: affectedDeals } = await sb
            .from("document_artifacts")
            .select("deal_id, bank_id")
            .in("id", artifactIds);

          // Deduplicate by deal_id
          const seen = new Set<string>();
          const uniqueDeals = (affectedDeals ?? []).filter((d: any) => {
            if (seen.has(d.deal_id)) return false;
            seen.add(d.deal_id);
            return true;
          });

          const { maybeTriggerDealNaming } = await import(
            "@/lib/naming/maybeTriggerDealNaming"
          );

          for (const d of uniqueDeals) {
            void maybeTriggerDealNaming(d.deal_id, {
              bankId: d.bank_id,
              reason: "artifact_batch_completed",
            }).catch(() => {});
          }
        }
      } catch (namingErr: any) {
        console.warn("[artifacts/process] post-batch naming trigger failed (non-fatal)", {
          error: namingErr?.message,
        });
      }
    }

    // === Stuck artifact detection (Section E) ===
    // Runs after every batch invocation (~1 min via cron). Non-fatal.
    let stuck: { queued: number; processing: number } | undefined;
    try {
      const sb = supabaseAdmin();
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const { count: stuckQueued } = await sb
        .from("document_artifacts")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued")
        .lt("created_at", fiveMinAgo);

      // IMPORTANT: `updated_at` (not `created_at`) is the correct staleness
      // signal for status='processing' rows. `created_at` is the row's
      // original queue-insertion timestamp — it never changes once a row
      // starts processing, so an artifact that merely sat `queued` for
      // >10 min before being claimed would already be eligible for "stuck"
      // reset on the very next tick, even though processing had only just
      // begun. That caused the self-heal to flip an in-flight artifact back
      // to `queued`, letting it be re-claimed and reprocessed CONCURRENTLY
      // with the still-running original invocation (duplicate DB writes,
      // duplicate LLM spend, duplicate downstream triggers).
      //
      // `updated_at` is touched both by the document_artifacts_updated_at
      // trigger and explicitly by claim_next_artifact_for_processing() at
      // the exact moment a row transitions to 'processing' (see
      // supabase/migrations/20260124000000_document_artifacts_and_matching.sql),
      // so it reliably reflects lease/processing-start time instead.
      const { data: stuckProcessingRows, error: stuckProcessingErr } = await sb
        .from("document_artifacts")
        .select("id, deal_id, bank_id")
        .eq("status", "processing")
        .lt("updated_at", tenMinAgo);

      if (stuckProcessingErr) {
        console.warn(
          "[artifacts/process] failed to query stuck-processing artifacts (non-fatal)",
          { error: stuckProcessingErr.message },
        );
      }

      const stuckProcessingList = stuckProcessingRows ?? [];
      const stuckProcessing = stuckProcessingList.length;
      const stuckProcessingIds = stuckProcessingList.map((r: any) => r.id);

      const totalStuck = (stuckQueued ?? 0) + stuckProcessing;

      if (totalStuck > 0) {
        stuck = { queued: stuckQueued ?? 0, processing: stuckProcessing };
        console.warn("[artifacts/process] STUCK ARTIFACTS DETECTED", {
          ...stuck,
          stuck_processing_artifact_ids: stuckProcessingIds,
        });

        // Get a sample deal for the ledger event
        const { data: sample } = await sb
          .from("document_artifacts")
          .select("deal_id, bank_id")
          .in("status", ["queued", "processing"])
          .lt("created_at", fiveMinAgo)
          .limit(1)
          .maybeSingle();

        if (sample) {
          await logLedgerEvent({
            dealId: sample.deal_id,
            bankId: sample.bank_id,
            eventKey: "artifacts.stuck",
            uiState: "error",
            uiMessage: `${totalStuck} document(s) stuck in processing queue`,
            meta: {
              stuck_queued: stuckQueued ?? 0,
              stuck_processing: stuckProcessing,
              threshold_queued_min: 5,
              threshold_processing_min: 10,
              stuck_processing_artifact_ids: stuckProcessingIds,
            },
          });

          void writeEvent({
            dealId: sample.deal_id,
            kind: "artifacts.stuck",
            meta: {
              stuck_queued: stuckQueued ?? 0,
              stuck_processing: stuckProcessing,
              total_stuck: totalStuck,
              stuck_processing_artifact_ids: stuckProcessingIds,
            },
          });
        }

        // Self-heal: reset processing artifacts stuck >10 min (by lease/claim
        // time) back to queued. Scoped to the exact IDs identified above
        // (rather than re-querying lt("updated_at", ...)) plus a status
        // guard, so we never reset a row that started processing — or
        // finished — between the SELECT above and this UPDATE.
        if (stuckProcessing > 0) {
          const { error: resetErr } = await sb
            .from("document_artifacts")
            .update({ status: "queued" } as any)
            .in("id", stuckProcessingIds)
            .eq("status", "processing");

          if (resetErr) {
            console.error("[artifacts/process] failed to reset stuck artifacts", {
              error: resetErr.message,
              artifact_ids: stuckProcessingIds,
            });
          } else {
            console.log("[artifacts/process] reset stuck processing artifacts to queued", {
              count: stuckProcessing,
              artifact_ids: stuckProcessingIds,
            });
          }
        }
      }
    } catch (stuckErr: any) {
      // Non-fatal: stuck detection must never break the batch response
      console.warn("[artifacts/process] stuck detection failed (non-fatal)", {
        error: stuckErr?.message,
      });
    }

    return NextResponse.json({
      ok: true,
      ...summary,
      ...(stuck ? { stuck } : {}),
      results: results.map((r) => ({
        artifact_id: r.artifactId,
        ok: r.ok,
        doc_type: r.classification?.docType,
        confidence: r.classification?.confidence,
        matched_keys: r.matchedKeys,
        error: r.error,
      })),
    });
  } catch (error: any) {
    console.error("[artifacts/process] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}

// Vercel Cron sends GET — delegate to POST (POST checks auth via isAuthorized)
export async function GET(req: NextRequest) {
  return POST(req);
}
