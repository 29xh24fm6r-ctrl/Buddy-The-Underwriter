/**
 * GET /api/workers/intake-outbox
 *
 * Vercel Cron entrypoint for durable intake processing.
 *
 * Schedule: every 5 minutes (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET (via hasValidWorkerSecret)
 *
 * Claims undelivered intake.process outbox rows and executes
 * runIntakeProcessing() for each. No HTTP lifecycle dependency.
 *
 * Singleton across concurrent invocations via PostgreSQL advisory lock
 * (WORKER_LOCK_KEYS.INTAKE_OUTBOX).
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { processIntakeOutbox } from "@/lib/workers/processIntakeOutbox";
import {
  WORKER_LOCK_KEYS,
  withWorkerAdvisoryLock,
  isWorkerLockSkip,
} from "@/lib/workers/workerLock";
import { resolveBatchSize } from "@/lib/workers/batchCaps";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — durable processing window

export async function GET(req: NextRequest) {
  const start = Date.now();
  // Startup probe — proves Vercel Cron is reaching this handler.
  // Search Vercel runtime logs for "cron_invocation_seen" to confirm scheduling.
  console.log("[intake-outbox] cron_invocation_seen", {
    ts: new Date().toISOString(),
    ua: req.headers.get("user-agent") ?? null,
  });

  if (!hasValidWorkerSecret(req)) {
    // Explicit auth failure log — distinguishes CRON_SECRET/WORKER_SECRET misconfiguration
    // from the cron never firing. If this appears in logs, the cron IS reaching the handler
    // but the secret is wrong or missing in the Vercel environment.
    console.error("[intake-outbox] auth_failed — check CRON_SECRET / WORKER_SECRET env vars");
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const max = resolveBatchSize(
    req.nextUrl.searchParams.get("max"),
    process.env.BUDDY_OUTBOX_BATCH_SIZE,
    "outbox",
  );

  const sb = supabaseAdmin();

  const result = await withWorkerAdvisoryLock({
    sb,
    lockKey: WORKER_LOCK_KEYS.INTAKE_OUTBOX,
    workerName: "intake-outbox",
    run: async () => processIntakeOutbox(max),
  });

  const durationMs = Date.now() - start;

  if (isWorkerLockSkip(result)) {
    return NextResponse.json({
      ok: true,
      worker: "intake_outbox",
      skipped: true,
      reason: "lock_not_acquired",
      durationMs,
    });
  }

  if (result.idle) {
    return NextResponse.json({
      ok: true,
      worker: "intake_outbox",
      skipped: true,
      reason: "idle_no_work",
      durationMs,
    });
  }

  return NextResponse.json({
    ok: true,
    worker: "intake_outbox",
    skipped: false,
    reason: null,
    claimed: result.claimed,
    processed: result.processed,
    failed: result.failed,
    dead_lettered: result.dead_lettered,
    durationMs,
  });
}
