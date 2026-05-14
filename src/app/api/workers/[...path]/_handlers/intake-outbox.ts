/**
 * GET /api/workers/intake-outbox
 *
 * Vercel Cron entrypoint for durable intake processing.
 *
 * Schedule: every 5 minutes (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET (via hasValidWorkerSecret)
 *
<<<<<<< HEAD:src/app/api/workers/[...path]/_handlers/intake-outbox.ts
 * Claims undelivered intake.process outbox rows via the transaction-scoped
 * claim_intake_outbox_with_xact_lock RPC and executes runIntakeProcessing()
 * for each. The advisory lock is held only for the claim transaction —
 * processing happens after the function returns, with no lock held.
 *
 * Singleton-claim semantics via PostgreSQL transaction-scoped advisory lock
 * (WORKER_LOCK_KEYS.INTAKE_OUTBOX = 42001003). See
 * SPEC-ADVISORY-LOCK-XACT-MIGRATION-1.
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { processIntakeOutbox } from "@/lib/workers/processIntakeOutbox";
import { resolveBatchSize } from "@/lib/workers/batchCaps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const start = Date.now();
  console.log("[intake-outbox] cron_invocation_seen", {
    ts: new Date().toISOString(),
    ua: req.headers.get("user-agent") ?? null,
  });

  if (!hasValidWorkerSecret(req)) {
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

  // claimWithXactLock is invoked inside processIntakeOutbox itself.
  const result = await processIntakeOutbox(max);

  const durationMs = Date.now() - start;

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
