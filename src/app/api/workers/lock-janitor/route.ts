/**
 * GET /api/workers/lock-janitor
 *
 * Vercel Cron janitor for leaked worker advisory locks and abandoned
 * Golden Trident bundle executions.
 *
 * Schedule: every 5 minutes (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET (via hasValidWorkerSecret)
 *
 * SPEC-ADVISORY-LOCK-XACT-MIGRATION-1.
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { summarizeLockJanitorRpcResults } from "@/lib/jobs/lockJanitorOutcome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const IDLE_THRESHOLD_SECONDS = 300;
const TRIDENT_RECONCILIATION_LIMIT = 100;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET(req: NextRequest) {
  const start = Date.now();
  console.log("[lock-janitor] cron_invocation_seen", {
    ts: new Date().toISOString(),
  });

  if (!hasValidWorkerSecret(req)) {
    console.error("[lock-janitor] auth_failed");
    return response({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const sb = supabaseAdmin();
    const [lockResult, tridentResult] = await Promise.allSettled([
      sb.rpc("release_stale_worker_advisory_locks", {
        p_idle_threshold_seconds: IDLE_THRESHOLD_SECONDS,
      }),
      sb.rpc("reconcile_stale_trident_bundle_runs", {
        p_limit: TRIDENT_RECONCILIATION_LIMIT,
      }),
    ]);

    const lockRejected = lockResult.status === "rejected";
    const tridentRejected = tridentResult.status === "rejected";
    const lockError = lockResult.status === "fulfilled" && Boolean(lockResult.value.error);
    const tridentError = tridentResult.status === "fulfilled" && Boolean(tridentResult.value.error);

    if (lockRejected || tridentRejected || lockError || tridentError) {
      console.error("[lock-janitor] rpc_failed", {
        advisoryLocks: lockRejected || lockError,
        tridentBundles: tridentRejected || tridentError,
      });
      return response(
        { ok: false, error: "janitor_rpc_failed", durationMs: Date.now() - start },
        503,
      );
    }

    const summary = summarizeLockJanitorRpcResults(
      lockResult.value.data,
      tridentResult.value.data,
    );

    if (summary.released > 0) {
      console.warn("[lock-janitor] released stale locks", {
        count: summary.released,
      });
    }

    if (summary.tridentReconciled > 0) {
      console.warn("[lock-janitor] reconciled stale trident bundles", {
        count: summary.tridentReconciled,
      });
    }

    return response(
      {
        ok: true,
        released: summary.released,
        tridentReconciled: summary.tridentReconciled,
        durationMs: Date.now() - start,
      },
      200,
    );
  } catch (error: unknown) {
    const code =
      error instanceof Error && error.message.startsWith("lock_janitor_invalid_")
        ? error.message
        : "lock_janitor_unavailable";
    console.error("[lock-janitor] janitor_failed", { code });
    return response(
      { ok: false, error: "janitor_failed", durationMs: Date.now() - start },
      503,
    );
  }
}
