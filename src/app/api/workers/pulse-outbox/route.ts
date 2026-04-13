/**
 * GET /api/workers/pulse-outbox
 *
 * Vercel Cron entry point for draining pipeline notification events
 * from buddy_outbox_events to Pulse.
 *
 * Schedule: every 2 minutes (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET
 *
 * Handles: checklist_reconciled, readiness_recomputed, artifact_processed,
 * manual_override, and all other non-intake outbox events.
 *
 * Does NOT handle intake.process events (those go to /api/workers/intake-outbox).
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { processPulseOutbox } from "@/lib/workers/processPulseOutbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
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

  try {
    const max = Math.min(
      Number(req.nextUrl.searchParams.get("max") ?? "50"),
      200,
    );

    const result = await processPulseOutbox(max);

    if (result.skipped_disabled) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "PULSE_TELEMETRY_ENABLED not set or ingest config missing",
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[pulse-outbox] worker error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
