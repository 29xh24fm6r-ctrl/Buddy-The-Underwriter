/**
 * Bounded telemetry retention orchestration.
 *
 * Each RPC deletes at most one database batch. Repetition lives here so every
 * RPC call commits independently. Tables advance round-robin so a large first
 * table cannot consume the worker budget before later tables receive a batch.
 */

type RpcResult = { data: unknown; error: { message?: string } | null };
type InsertResult = { error?: { message?: string } | null };
type SB = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<InsertResult>;
  };
};

const PURGE_RPCS = [
  { rpcName: "purge_buddy_system_events", table: "buddy_system_events" },
  { rpcName: "purge_franchise_sync_runs", table: "franchise_sync_runs" },
  { rpcName: "purge_buddy_workers", table: "buddy_workers" },
] as const;

const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_MAX_BATCHES_PER_TABLE = 25;
const DEFAULT_TIME_BUDGET_MS = 45_000;

export type PurgeStopReason =
  | "drained"
  | "batch_limit"
  | "time_budget"
  | "rpc_error";

export type PurgeResult = {
  table: string;
  rpcName: string;
  rowsPurged: number;
  batches: number;
  complete: boolean;
  stoppedReason: PurgeStopReason;
  error?: string;
};

export type RetentionOptions = {
  batchSize?: number;
  maxBatchesPerTable?: number;
  timeBudgetMs?: number;
  now?: () => number;
};

type PurgeState = PurgeResult & { active: boolean };

export async function runTelemetryRetentionPurge(
  sb: SB,
  options: RetentionOptions = {},
): Promise<PurgeResult[]> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatchesPerTable =
    options.maxBatchesPerTable ?? DEFAULT_MAX_BATCHES_PER_TABLE;
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const states: PurgeState[] = PURGE_RPCS.map(({ rpcName, table }) => ({
    table,
    rpcName,
    rowsPurged: 0,
    batches: 0,
    complete: false,
    stoppedReason: "batch_limit",
    active: true,
  }));

  let timeBudgetReached = false;

  for (
    let round = 0;
    round < maxBatchesPerTable && states.some((state) => state.active);
    round += 1
  ) {
    for (const state of states) {
      if (!state.active) continue;

      if (now() - startedAt >= timeBudgetMs) {
        for (const pending of states) {
          if (pending.active) {
            pending.stoppedReason = "time_budget";
            pending.active = false;
          }
        }
        timeBudgetReached = true;
        break;
      }

      const { data, error } = await sb.rpc(state.rpcName);
      if (error) {
        state.stoppedReason = "rpc_error";
        state.error = error.message ?? "unknown error";
        state.active = false;
        continue;
      }

      const deleted = Number(data ?? 0);
      if (!Number.isFinite(deleted) || deleted < 0) {
        state.stoppedReason = "rpc_error";
        state.error = `invalid purge row count: ${String(data)}`;
        state.active = false;
        continue;
      }

      state.rowsPurged += deleted;
      state.batches += 1;

      if (deleted < batchSize) {
        state.complete = true;
        state.stoppedReason = "drained";
        state.active = false;
      }
    }

    if (timeBudgetReached) break;
  }

  const results: PurgeResult[] = states.map(
    ({ active: _active, ...result }) => result,
  );
  const allComplete = results.every((result) => result.complete);
  const event = {
    event_type: allComplete
      ? "telemetry_retention_purge_completed"
      : "telemetry_retention_purge_partial",
    severity: allComplete ? "info" : "warning",
    source_system: "nightly-cron",
    payload: { results },
  };

  const { error: auditError } = await sb
    .from("buddy_system_events")
    .insert(event);
  if (auditError) {
    throw new Error(
      `telemetry retention evidence write failed: ${auditError.message ?? "unknown error"}`,
    );
  }

  return results;
}
