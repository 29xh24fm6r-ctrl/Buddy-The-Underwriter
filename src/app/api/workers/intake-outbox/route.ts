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
  if (!hasValidWorkerSecret(req)) {
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
