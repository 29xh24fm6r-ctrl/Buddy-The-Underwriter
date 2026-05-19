/**
 * GET /api/workers/lock-janitor
 *
 * Vercel Cron belt-and-suspenders janitor for worker advisory locks.
 *
 * Schedule: every 5 minutes (vercel.json cron)
 * Auth: CRON_SECRET or WORKER_SECRET (via hasValidWorkerSecret)
 *
 * Calls release_stale_worker_advisory_locks() which terminates idle
 * postgrest pool connections holding any of the 5 worker advisory lock
 * keys (42001001-42001005) longer than the idle threshold. Terminating
 * the connection releases its session-scoped locks as a side effect.
 *
 * Required because pulse-outbox, ledger-forwarder, and spreads-worker
 * still use the session-scoped withWorkerAdvisoryLock pattern and the
 * supabase-js connection pool can leak locks between the lock + unlock
 * RPC calls. The xact-lock workers (doc-extraction, intake-outbox)
 * don't leak, but the janitor keys cover their lock-keys too as
 * defense-in-depth.
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

const IDLE_THRESHOLD_SECONDS = 300; // 5 minutes

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

  const { data, error } = await sb.rpc("release_stale_worker_advisory_locks", {
    p_idle_threshold_seconds: IDLE_THRESHOLD_SECONDS,
  });

  if (error) {
    console.error("[lock-janitor] rpc_failed", error.message);
    return NextResponse.json(
      { ok: false, error: error.message, durationMs: Date.now() - start },
      { status: 500 },
    );
  }

  const released = (data ?? []) as Array<{
    terminated_pid: number;
    released_lock_key: number;
  }>;

  if (released.length > 0) {
    console.warn("[lock-janitor] released stale locks", {
      count: released.length,
      details: released,
    });
  }

  return NextResponse.json({
    ok: true,
    released: released.length,
    details: released,
    durationMs: Date.now() - start,
  });
}
