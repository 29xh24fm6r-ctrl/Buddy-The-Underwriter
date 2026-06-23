/**
 * GET /api/workers/doc-extraction
 *
 * Vercel Cron for async per-document extraction.
 *
 * Schedule: every 2 minutes (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET
 * maxDuration: 300s (Vercel max)
 *
 * Claims 'doc.extract' outbox events via the transaction-scoped
 * claim_doc_extraction_with_xact_lock RPC and runs extractByDocType() for
 * each. The advisory lock is held only for the claim transaction —
 * processing happens after the function returns, with no lock held.
 *
 * Singleton-claim semantics via PostgreSQL transaction-scoped advisory lock
 * (WORKER_LOCK_KEYS.DOC_EXTRACTION_OUTBOX = 42001002). See
 * SPEC-ADVISORY-LOCK-XACT-MIGRATION-1.
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { processDocExtractionOutbox } from "@/lib/workers/processDocExtractionOutbox";
import { resolveBatchSize } from "@/lib/workers/batchCaps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const start = Date.now();
  console.log("[doc-extraction] cron_invocation_seen", {
    ts: new Date().toISOString(),
    ua: req.headers.get("user-agent") ?? null,
    fanOutIndex: req.headers.get("x-fan-out-index") ?? "cron",
  });

  if (!hasValidWorkerSecret(req)) {
    console.error("[doc-extraction] auth_failed — check CRON_SECRET / WORKER_SECRET env vars");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const max = resolveBatchSize(
    req.nextUrl.searchParams.get("max"),
    process.env.BUDDY_DOC_EXTRACTION_BATCH_SIZE,
    "docExtraction",
  );

  // claimWithXactLock is invoked inside processDocExtractionOutbox itself.
  // Lock skip vs idle no-work are distinguished by the processor's return shape:
  //   - lock skip → claimed=0, processed=0 (logged at RPC layer)
  //   - idle no-work → idle=true
  const result = await processDocExtractionOutbox(max);

  const durationMs = Date.now() - start;

  if (result.idle) {
    return NextResponse.json({
      ok: true,
      worker: "doc_extraction",
      skipped: true,
      reason: "idle_no_work",
      durationMs,
    });
  }

  return NextResponse.json({
    ok: true,
    worker: "doc_extraction",
    skipped: false,
    reason: null,
    claimed: result.claimed,
    processed: result.processed,
    failed: result.failed,
    dead_lettered: result.dead_lettered,
    durationMs,
  });
}
