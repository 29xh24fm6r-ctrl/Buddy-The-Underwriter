/**
 * GET /api/workers/intake-recovery
 *
 * Server-side self-healing cron for stuck intake processing.
 *
 * Schedule: every 3 minutes (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET (via hasValidWorkerSecret)
 *
 * Three recovery checks — all outbox-driven, all ledgered:
 *
 *   A) Re-enqueue confirmed deals with no live outbox row
 *   B) Emit observability event for long-stalled claimed rows
 *   C) Re-enqueue dead-lettered rows whose deal is still confirmed
 *
 * Invariants:
 *   - NEVER calls runIntakeProcessing or processConfirmedIntake
 *   - NEVER mutates deal phase directly
 *   - All recovery enters through the outbox
 *   - Rate-limited: max one outbox row per deal per 10 minutes
 *   - Idempotent: safe to run concurrently or overlapping
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { recoverStuckIntakeDeals } from "@/lib/workers/recoverStuckIntakeDeals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!hasValidWorkerSecret(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const result = await recoverStuckIntakeDeals();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[intake-recovery] worker error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
