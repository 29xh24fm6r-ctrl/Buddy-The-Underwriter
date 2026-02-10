import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { runObserverTick } from "@/lib/aegis/observerLoop";
import { writeSystemEvent } from "@/lib/aegis/writeSystemEvent";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ops/observer/tick
 *
 * Runs the Aegis observer scan loop.
 * Called by Vercel cron every 5 minutes.
 *
 * Auth: CRON_SECRET (Vercel auto-inject), WORKER_SECRET, or super_admin session.
 *
 * ALWAYS returns JSON — never a blank page.
 */
export async function POST(req: NextRequest) {
  if (!hasValidWorkerSecret(req)) {
    try {
      await requireSuperAdmin();
    } catch {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  const startedAt = Date.now();

  try {
    const result = await runObserverTick();
    const durationMs = Date.now() - startedAt;

    return NextResponse.json({ ...result, duration_ms: durationMs });
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    const safeError = err?.message ?? String(err);

    // Failure heartbeat — ensure health endpoint sees a recent tick even on crash
    writeSystemEvent({
      event_type: "heartbeat",
      severity: "error",
      source_system: "observer",
      resolution_status: "open",
      error_class: "transient",
      error_message: `Observer tick crashed: ${safeError.slice(0, 200)}`,
      payload: {
        ok: false,
        duration_ms: durationMs,
        observer_decision: "tick_crashed",
      },
    }).catch(() => {});

    return NextResponse.json(
      { ok: false, error: "observer_failed", detail: safeError, duration_ms: durationMs },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ops/observer/tick
 *
 * Delegates to POST — allows manual browser debugging.
 */
export async function GET(req: NextRequest) {
  return POST(req);
}
