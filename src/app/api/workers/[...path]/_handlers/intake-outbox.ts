/**
 * GET /api/workers/intake-outbox
 *
 * Vercel Cron entrypoint for durable intake processing.
 *
 * Schedule: every 5 minutes (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET (via hasValidWorkerSecret)
 *
 * SPEC-INTAKE-FLOW-FIX-1: Advisory lock wraps ONLY the idle probe + claim
 * step (milliseconds). Processing happens OUTSIDE the lock. This prevents
 * pgBouncer connection recycling from orphaning the lock when Gemini OCR
 * calls take 30-120s per document.
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { processIntakeOutbox } from "@/lib/workers/processIntakeOutbox";
import { resolveBatchSize } from "@/lib/workers/batchCaps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — durable processing window

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

  // SPEC-INTAKE-FLOW-FIX-1: No advisory lock wrapper here.
  // processIntakeOutbox uses claim_intake_outbox_batch RPC with
  // FOR UPDATE SKIP LOCKED — the claim itself is the concurrency guard.
  // The advisory lock was previously held across the entire processing
  // loop (including Gemini OCR), causing zombie locks on pgBouncer
  // connection recycling.
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
