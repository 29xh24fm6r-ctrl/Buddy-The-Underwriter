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

export async function POST(request: Request) {
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
  let body: Record<string, any> = {};
  try { body = await request.json(); } catch { /* empty ok */ }
  const limit = parseCronLimit(body);

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
