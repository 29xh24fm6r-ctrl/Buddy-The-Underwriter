/**
 * Cross-invocation worker singleton via PostgreSQL advisory locks.
 *
 * This file exports two patterns. New worker code should prefer
 * claimWithXactLock; withWorkerAdvisoryLock is kept for workers that have
 * not yet been migrated to a single-RPC claim path.
 *
 * ─── claimWithXactLock (preferred, transaction-scoped) ─────────────────
 * SPEC-ADVISORY-LOCK-XACT-MIGRATION-1. Each migrated worker has a
 * dedicated PL/pgSQL function (`claim_<worker>_with_xact_lock`) that calls
 * pg_try_advisory_xact_lock + the existing claim SQL inside a single
 * transaction. The lock is released automatically at function COMMIT, so
 * the supabase-js connection-pool routing cannot leak it. The function
 * returns the claimed rows; the worker processes them after the function
 * returns. Workers migrated: doc-extraction, intake-outbox.
 *
 * ─── withWorkerAdvisoryLock (legacy, session-scoped) ───────────────────
 * Calls public.pg_try_advisory_lock(bigint) + pg_advisory_unlock(bigint)
 * via RPC. Two RPC calls go through different pool connections in
 * supabase-js, so the unlock often routes to a connection that doesn't
 * hold the lock — locks leak onto the pool and accumulate. The
 * release_stale_worker_advisory_locks() janitor (cron every 5 min)
 * terminates idle postgrest connections holding any of our 5 worker
 * advisory keys to bound the damage. Workers still on this pattern:
 * pulse-outbox, ledger-forwarder, spreads-worker.
 *
 * Lock keys:
 *   - pulse outbox forwarder         42001001
 *   - doc extraction outbox          42001002
 *   - intake outbox                  42001003
 *   - deal pipeline ledger forwarder 42001004
 *   - spreads worker / monitor       42001005
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

/**
 * Legacy session-scoped advisory-lock wrapper. Acquires
 * public.pg_try_advisory_lock(lock_id) before `run()` and releases via
 * public.pg_advisory_unlock(lock_id) in a finally block. Vulnerable to
 * pool-connection routing across the two RPC calls — the janitor RPC
 * release_stale_worker_advisory_locks() is the safety net.
 *
 * Prefer claimWithXactLock for new workers.
 */
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

// ─── claimWithXactLock (transaction-scoped, preferred) ────────────────────

export type XactLockWorkerName = "doc-extraction" | "intake-outbox";

const XACT_LOCK_RPC_BY_WORKER: Record<XactLockWorkerName, string> = {
  "doc-extraction": "claim_doc_extraction_outbox_batch",
  "intake-outbox": "claim_intake_outbox_batch",
};

export type ClaimedRow = {
  id: string;
  deal_id: string;
  bank_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  lock_acquired: boolean;
};

export type ClaimResult =
  | { skipped: true; reason: "lock_not_acquired"; rows: [] }
  | { skipped: false; rows: ClaimedRow[] };

/**
 * Acquire a transaction-scoped advisory lock and claim a batch of outbox
 * rows in a single PL/pgSQL function. The lock is released at function
 * COMMIT — there is no separate unlock RPC, so the connection-pool
 * routing problem that plagues withWorkerAdvisoryLock cannot occur.
 *
 * Caller processes the returned rows AFTER the function returns. The
 * advisory lock is only held for the few milliseconds the claim takes.
 *
 * Returns `{ skipped: true, reason: "lock_not_acquired" }` when another
 * concurrent invocation holds the lock. RPC errors are also reported as
 * skipped to keep the cron quiet — the next tick retries.
 */
export async function claimWithXactLock(opts: {
  sb: SupabaseClient<any> | WorkerLockClient;
  workerName: XactLockWorkerName;
  claimOwner: string;
  claimTtlSeconds: number;
  limit: number;
}): Promise<ClaimResult> {
  const { sb, workerName, claimOwner, claimTtlSeconds, limit } = opts;
  const rpcName = XACT_LOCK_RPC_BY_WORKER[workerName];

  const { data, error } = await (sb as WorkerLockClient).rpc(rpcName, {
    p_claim_owner: claimOwner,
    p_claim_ttl_seconds: claimTtlSeconds,
    p_limit: limit,
  });

  if (error) {
    console.error(
      `[${workerName}] xact_claim_rpc_failed`,
      (error as { message?: string }).message ?? String(error),
    );
    return { skipped: true, reason: "lock_not_acquired", rows: [] };
  }

  const rows = (data as ClaimedRow[] | null) ?? [];

  // The claim RPCs use FOR UPDATE SKIP LOCKED — they return 0 rows when
  // another worker holds the lock or no work exists. No sentinel row needed.
  return { skipped: false, rows };
}

export function isClaimSkip(
  result: ClaimResult,
): result is { skipped: true; reason: "lock_not_acquired"; rows: [] } {
  return result.skipped === true;
}
