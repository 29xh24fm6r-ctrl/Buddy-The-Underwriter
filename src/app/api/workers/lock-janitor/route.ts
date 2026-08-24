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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const IDLE_THRESHOLD_SECONDS = 300;
const TRIDENT_RECONCILIATION_LIMIT = 100;

type ReleasedLock = {
  terminated_pid: number;
  released_lock_key: number;
};

type ReconciledTridentBundle = {
  bundle_id: string;
  deal_id: string;
  previous_stage: string | null;
};

export async function GET(req: NextRequest) {
  const start = Date.now();
  console.log("[lock-janitor] cron_invocation_seen", {
    ts: new Date().toISOString(),
  });

  if (!hasValidWorkerSecret(req)) {
    console.error("[lock-janitor] auth_failed");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const [lockResult, tridentResult] = await Promise.all([
    sb.rpc("release_stale_worker_advisory_locks", {
      p_idle_threshold_seconds: IDLE_THRESHOLD_SECONDS,
    }),
    sb.rpc("reconcile_stale_trident_bundle_runs", {
      p_limit: TRIDENT_RECONCILIATION_LIMIT,
    }),
  ]);

  if (lockResult.error || tridentResult.error) {
    const errors = {
      advisoryLocks: lockResult.error?.message ?? null,
      tridentBundles: tridentResult.error?.message ?? null,
    };
    console.error("[lock-janitor] rpc_failed", errors);
    return NextResponse.json(
      { ok: false, errors, durationMs: Date.now() - start },
      { status: 500 },
    );
  }

  const released = (lockResult.data ?? []) as ReleasedLock[];
  const tridentReconciled = (tridentResult.data ?? []) as ReconciledTridentBundle[];

  if (released.length > 0) {
    console.warn("[lock-janitor] released stale locks", {
      count: released.length,
      details: released,
    });
  }

  if (tridentReconciled.length > 0) {
    console.warn("[lock-janitor] reconciled stale trident bundles", {
      count: tridentReconciled.length,
      details: tridentReconciled,
    });
  }

  return NextResponse.json({
    ok: true,
    released: released.length,
    details: released,
    tridentReconciled: tridentReconciled.length,
    tridentDetails: tridentReconciled,
    durationMs: Date.now() - start,
  });
}
