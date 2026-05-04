/**
 * Cross-invocation worker singleton via PostgreSQL advisory locks.
 *
 * Vercel cron can fire concurrent invocations (overlap, retry, drift). When two
 * invocations of the same worker run at the same time, both hammer Supabase
 * with identical claim queries and produce duplicate work. The advisory lock
 * makes a worker "single-flight" across the whole cluster — second concurrent
 * invocation immediately returns a `lock_not_acquired` skip without touching
 * any worker tables.
 *
 * Lock keys are hardcoded bigints (one per worker). Do not reuse keys across
 * unrelated workers — that would serialize their cron schedules together.
 *
 *   - pulse outbox forwarder         42001001
 *   - doc extraction outbox          42001002
 *   - intake outbox                  42001003
 *   - deal pipeline ledger forwarder 42001004
 *   - spreads worker / monitor       42001005
 *
 * RPCs `pg_try_advisory_lock(bigint)` and `pg_advisory_unlock(bigint)` are
 * defined in supabase/migrations/20251219000000_advisory_lock_functions.sql.
 */

import { assertServerOnly } from "@/lib/serverOnly";
import type { SupabaseClient } from "@supabase/supabase-js";

assertServerOnly();

export const WORKER_LOCK_KEYS = {
  PULSE_OUTBOX: 42001001,
  DOC_EXTRACTION_OUTBOX: 42001002,
  INTAKE_OUTBOX: 42001003,
  LEDGER_FORWARDER: 42001004,
  SPREADS_WORKER: 42001005,
} as const;

export type WorkerLockKey =
  (typeof WORKER_LOCK_KEYS)[keyof typeof WORKER_LOCK_KEYS];

export type WorkerLockSkip = {
  skipped: true;
  reason: "lock_not_acquired";
};

/**
 * Minimal client surface used by withWorkerAdvisoryLock — narrowed so tests can
 * pass a tiny stub without importing supabase-js.
 */
export interface WorkerLockClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export async function withWorkerAdvisoryLock<T>(opts: {
  sb: SupabaseClient<any> | WorkerLockClient;
  lockKey: number;
  workerName: string;
  run: () => Promise<T>;
}): Promise<T | WorkerLockSkip> {
  const { sb, lockKey, workerName, run } = opts;

  let acquired = false;
  try {
    const { data, error } = await (sb as WorkerLockClient).rpc(
      "pg_try_advisory_lock",
      { lock_id: lockKey },
    );
    if (error) {
      console.warn(
        `[${workerName}] advisory_lock_acquire_failed`,
        error.message,
      );
      return { skipped: true, reason: "lock_not_acquired" };
    }
    acquired = data === true;
  } catch (err: any) {
    console.warn(
      `[${workerName}] advisory_lock_threw`,
      err?.message ?? String(err),
    );
    return { skipped: true, reason: "lock_not_acquired" };
  }

  if (!acquired) {
    return { skipped: true, reason: "lock_not_acquired" };
  }

  try {
    return await run();
  } finally {
    try {
      const { error } = await (sb as WorkerLockClient).rpc(
        "pg_advisory_unlock",
        { lock_id: lockKey },
      );
      if (error) {
        console.warn(
          `[${workerName}] advisory_unlock_failed`,
          error.message,
        );
      }
    } catch (err: any) {
      console.warn(
        `[${workerName}] advisory_unlock_threw`,
        err?.message ?? String(err),
      );
    }
  }
}

export function isWorkerLockSkip<T>(
  v: T | WorkerLockSkip,
): v is WorkerLockSkip {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as WorkerLockSkip).skipped === true &&
    (v as WorkerLockSkip).reason === "lock_not_acquired"
  );
}
