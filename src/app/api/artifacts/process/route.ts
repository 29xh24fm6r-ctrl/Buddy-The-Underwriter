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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max for processing

/** Check if the request is authorized via internal header or worker secret. */
function isAuthorized(req: NextRequest): boolean {
  // Internal server-to-server call (same-origin, injected by upload route)
  if (req.headers.get("x-buddy-internal") === "1") return true;

  // Worker secret (cron / external worker)
  const secret = process.env.WORKER_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth === `Bearer ${secret}`) return true;
    if (req.headers.get("x-worker-secret") === secret) return true;
    const url = new URL(req.url);
    if (url.searchParams.get("token") === secret) return true;
  }

  return false;
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

    const startTime = Date.now();
    const results = await processBatch(max);
    const duration = Date.now() - startTime;

    const summary = {
      processed: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      duration_ms: duration,
    };

    console.log("[artifacts/process] batch complete", summary);

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

      const { count: stuckProcessing } = await sb
        .from("document_artifacts")
        .select("id", { count: "exact", head: true })
        .eq("status", "processing")
        .lt("created_at", tenMinAgo);

      const totalStuck = (stuckQueued ?? 0) + (stuckProcessing ?? 0);

      if (totalStuck > 0) {
        stuck = { queued: stuckQueued ?? 0, processing: stuckProcessing ?? 0 };
        console.warn("[artifacts/process] STUCK ARTIFACTS DETECTED", stuck);

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
              stuck_processing: stuckProcessing ?? 0,
              threshold_queued_min: 5,
              threshold_processing_min: 10,
            },
          });

          void writeEvent({
            dealId: sample.deal_id,
            kind: "artifacts.stuck",
            meta: {
              stuck_queued: stuckQueued ?? 0,
              stuck_processing: stuckProcessing ?? 0,
              total_stuck: totalStuck,
            },
          });
        }

        // Self-heal: reset processing artifacts stuck >10 min back to queued
        if ((stuckProcessing ?? 0) > 0) {
          const { error: resetErr } = await sb
            .from("document_artifacts")
            .update({ status: "queued" } as any)
            .eq("status", "processing")
            .lt("created_at", tenMinAgo);

          if (resetErr) {
            console.error("[artifacts/process] failed to reset stuck artifacts", {
              error: resetErr.message,
            });
          } else {
            console.log("[artifacts/process] reset stuck processing artifacts to queued", {
              count: stuckProcessing,
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

// GET for dev testing only
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "GET not allowed in production" },
      { status: 405 },
    );
  }
  return POST(req);
}
