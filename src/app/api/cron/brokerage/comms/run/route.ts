import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runBrokerageCommsBatch } from "@/lib/brokerage/commsOrchestrator";
import { getCommsMode } from "@/lib/brokerage/commsAdapters";
import { redactResponseSecrets } from "@/lib/brokerage/commsAuth";
import {
  verifyCronSecret,
  checkCronEnvReadiness,
  parseCronLimit,
  emitCronStarted,
  emitCronCompleted,
  emitCronFailed,
  type CronRunResult,
} from "@/lib/brokerage/commsCron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The batch itself. Both verbs run it: POST keeps the existing contract for
 * manual and scripted invocation, GET exists because Vercel Cron issues GET
 * and nothing else — a POST-only route is why this sender, though complete,
 * had never once been invoked in production. Every other scheduled cron in
 * this repo exports GET for the same reason.
 */
async function runCommsCron(request: Request, limitOverride?: number) {
  // 1. Auth
  const auth = verifyCronSecret(request);
  if (!auth.authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // 2. Env readiness
  const envCheck = checkCronEnvReadiness();
  if (!envCheck.ready) {
    return NextResponse.json(
      redactResponseSecrets({ ok: false, error: "env_not_ready", issues: envCheck.issues }),
      { status: 503 },
    );
  }

  const sb = supabaseAdmin() as any;
  const mode = getCommsMode();
  let limit: number;
  if (limitOverride !== undefined) {
    limit = limitOverride;
  } else {
    let body: Record<string, any> = {};
    try { body = await request.json(); } catch { /* empty ok */ }
    limit = parseCronLimit(body);
  }

  try {
    await emitCronStarted(sb, mode, limit);

    const batch = await runBrokerageCommsBatch(sb, {
      processOutbox: true,
      limit,
    });

    const result: CronRunResult = {
      ok: true,
      mode,
      dealsProcessed: batch.dealsProcessed,
      totalEnqueued: batch.totalEnqueued,
      totalSkipped: batch.totalSkipped,
      warnings: batch.warnings.slice(0, 10),
    };

    await emitCronCompleted(sb, result);

    return NextResponse.json(redactResponseSecrets(result));
  } catch (err: any) {
    const msg = String(err?.message ?? "unknown");
    await emitCronFailed(sb, msg);
    return NextResponse.json(
      redactResponseSecrets({ ok: false, error: "cron_failed", message: msg }),
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return runCommsCron(request);
}

/**
 * Vercel Cron calls this. The limit rides in the query string because a cron
 * GET carries no body; auth is the Authorization: Bearer header Vercel sends,
 * which verifyCronSecret already accepts.
 */
export async function GET(request: Request) {
  const raw = Number(new URL(request.url).searchParams.get("limit"));
  return runCommsCron(request, parseCronLimit({ limit: Number.isFinite(raw) ? raw : undefined }));
}
