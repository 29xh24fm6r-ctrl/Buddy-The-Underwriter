/**
 * GET /api/workers/intake-outbox
 *
 * Vercel Cron entrypoint for durable intake processing.
 *
 * Schedule: every 1 minute (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET (via hasValidWorkerSecret)
 *
 * Claims undelivered intake.process outbox rows and executes
 * runIntakeProcessing() for each. No HTTP lifecycle dependency.
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { processIntakeOutbox } from "@/lib/workers/processIntakeOutbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — durable processing window

export async function GET(req: NextRequest) {
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

  try {
    const max = Math.min(
      Number(req.nextUrl.searchParams.get("max") ?? "5"),
      20,
    );

    const result = await processIntakeOutbox(max);

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[intake-outbox] worker error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
