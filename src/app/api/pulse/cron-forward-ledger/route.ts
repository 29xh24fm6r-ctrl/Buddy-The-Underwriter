/**
 * POST /api/pulse/cron-forward-ledger
 *
 * Vercel Cron entry point for the Pulse ledger forwarder.
 * No secrets in the URL — auth via CRON_SECRET Bearer token
 * (set automatically by Vercel for cron jobs).
 *
 * Calls the shared forwardLedgerBatch core directly. Singleton across
 * concurrent invocations via PostgreSQL advisory lock
 * (WORKER_LOCK_KEYS.LEDGER_FORWARDER).
 */

import { NextRequest, NextResponse } from "next/server";
import { forwardLedgerBatch } from "@/lib/pulse/forwardLedgerCore";
import {
  WORKER_LOCK_KEYS,
  withWorkerAdvisoryLock,
  isWorkerLockSkip,
} from "@/lib/workers/workerLock";
import { resolveBatchSize } from "@/lib/workers/batchCaps";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isCronAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return auth === `Bearer ${cronSecret}`;
}

export async function POST(req: NextRequest) {
  const start = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const max = resolveBatchSize(
    url.searchParams.get("max"),
    process.env.BUDDY_LEDGER_FORWARD_BATCH_SIZE,
    "ledger",
  );

  const sb = supabaseAdmin();

  const result = await withWorkerAdvisoryLock({
    sb,
    lockKey: WORKER_LOCK_KEYS.LEDGER_FORWARDER,
    workerName: "pulse-forwarder",
    run: async () => forwardLedgerBatch({ max }),
  });

  const durationMs = Date.now() - start;

  if (isWorkerLockSkip(result)) {
    return NextResponse.json({
      ok: true,
      worker: "pulse_forwarder",
      skipped: true,
      reason: "lock_not_acquired",
      durationMs,
    });
  }

  if (result.skipped) {
    return NextResponse.json({
      ok: true,
      worker: "pulse_forwarder",
      skipped: true,
      reason: result.reason ?? "skipped",
      durationMs,
    });
  }

  return NextResponse.json({
    ok: result.ok,
    worker: "pulse_forwarder",
    skipped: false,
    reason: null,
    claimed: result.attempted,
    processed: result.forwarded,
    failed: result.failed,
    dead_lettered: result.deadlettered,
    durationMs,
  });
}

// Vercel Cron sends GET — delegate to POST (POST checks cron auth)
export async function GET(req: NextRequest) {
  return POST(req);
}
