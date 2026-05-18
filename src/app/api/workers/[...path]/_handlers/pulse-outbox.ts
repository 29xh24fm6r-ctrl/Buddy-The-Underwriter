/**
 * GET /api/workers/pulse-outbox
 *
 * Vercel Cron entry point for draining pipeline notification events
 * from buddy_outbox_events to Pulse.
 *
 * Schedule: every 5 minutes (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET
 *
 * Handles: checklist_reconciled, readiness_recomputed, artifact_processed,
 * manual_override, and all other non-intake outbox events.
 *
 * Does NOT handle intake.process events (those go to /api/workers/intake-outbox).
 *
 * Singleton across concurrent invocations via PostgreSQL advisory lock
 * (WORKER_LOCK_KEYS.PULSE_OUTBOX). Idle invocations short-circuit before
 * any heartbeat or claim transaction is written.
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { processPulseOutbox } from "@/lib/workers/processPulseOutbox";
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
  console.log("[pulse-outbox] cron_invocation_seen", {
    ts: new Date().toISOString(),
    ua: req.headers.get("user-agent") ?? null,
  });

  if (!hasValidWorkerSecret(req)) {
    console.error(
      "[pulse-outbox] auth_failed — check CRON_SECRET / WORKER_SECRET",
    );
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
    lockKey: WORKER_LOCK_KEYS.PULSE_OUTBOX,
    workerName: "pulse-outbox",
    run: async () => processPulseOutbox(max),
  });

  const durationMs = Date.now() - start;

  if (isWorkerLockSkip(result)) {
    return NextResponse.json({
      ok: true,
      worker: "pulse_outbox",
      skipped: true,
      reason: "lock_not_acquired",
      durationMs,
    });
  }

  if (result.skipped_disabled) {
    return NextResponse.json({
      ok: true,
      worker: "pulse_outbox",
      skipped: true,
      reason: "telemetry_disabled",
      durationMs,
    });
  }

  if (result.idle) {
    return NextResponse.json({
      ok: true,
      worker: "pulse_outbox",
      skipped: true,
      reason: "idle_no_work",
      durationMs,
    });
  }

  return NextResponse.json({
    ok: true,
    worker: "pulse_outbox",
    skipped: false,
    reason: null,
    claimed: result.claimed,
    processed: result.forwarded,
    failed: result.failed,
    dead_lettered: result.dead_lettered,
    durationMs,
  });
}
