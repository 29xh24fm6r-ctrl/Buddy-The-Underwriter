/**
 * GET /api/workers/doc-extraction
 *
 * Vercel Cron for async per-document extraction.
 *
 * Schedule: every 1 minute (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET
 * maxDuration: 300s (Vercel max)
 *
 * Claims 'doc.extract' outbox events and runs extractByDocType() for each.
 * Decoupled from intake processing to avoid the 240s soft deadline.
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { processDocExtractionOutbox } from "@/lib/workers/processDocExtractionOutbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  console.log("[doc-extraction] cron_invocation_seen", {
    ts: new Date().toISOString(),
    ua: req.headers.get("user-agent") ?? null,
  });

  if (!hasValidWorkerSecret(req)) {
    console.error("[doc-extraction] auth_failed — check CRON_SECRET / WORKER_SECRET env vars");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const max = Math.min(
      Number(req.nextUrl.searchParams.get("max") ?? "10"),
      20,
    );

    const result = await processDocExtractionOutbox(max);

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[doc-extraction] worker error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
