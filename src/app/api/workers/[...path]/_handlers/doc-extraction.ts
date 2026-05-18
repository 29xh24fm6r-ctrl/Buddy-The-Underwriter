/**
 * GET /api/workers/doc-extraction
 *
 * Vercel Cron for async per-document extraction.
 *
 * Schedule: every 5 minutes (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET
 * maxDuration: 300s (Vercel max)
 *
 * Claims 'doc.extract' outbox events and runs extractByDocType() for each.
 * Decoupled from intake processing to avoid the 240s soft deadline.
 *
 * Singleton across concurrent invocations via PostgreSQL advisory lock
 * (WORKER_LOCK_KEYS.DOC_EXTRACTION_OUTBOX).
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { processDocExtractionOutbox } from "@/lib/workers/processDocExtractionOutbox";
import {
  WORKER_LOCK_KEYS,
  withWorkerAdvisoryLock,
  isWorkerLockSkip,
} from "@/lib/workers/workerLock";
import { resolveBatchSize } from "@/lib/workers/batchCaps";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

  const sb = supabaseAdmin();

  const result = await withWorkerAdvisoryLock({
    sb,
    lockKey: WORKER_LOCK_KEYS.DOC_EXTRACTION_OUTBOX,
    workerName: "doc-extraction",
    run: async () => processDocExtractionOutbox(max),
  });

  const durationMs = Date.now() - start;

  if (isWorkerLockSkip(result)) {
    return NextResponse.json({
      ok: true,
      worker: "doc_extraction",
      skipped: true,
      reason: "lock_not_acquired",
      durationMs,
    });
  }

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
