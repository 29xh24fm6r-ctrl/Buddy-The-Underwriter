/**
 * Bounded telemetry retention orchestration.
 *
 * Each RPC deletes at most one database batch. Repetition lives here so every
 * RPC call commits independently and a large first table cannot hold one
 * transaction until PostgREST's statement timeout.
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
  const results: PurgeResult[] = [];

  for (const { rpcName, table } of PURGE_RPCS) {
    let rowsPurged = 0;
    let batches = 0;
    let complete = false;
    let stoppedReason: PurgeStopReason = "batch_limit";
    let failure: string | undefined;

    while (batches < maxBatchesPerTable) {
      if (now() - startedAt >= timeBudgetMs) {
        stoppedReason = "time_budget";
        break;
      }

      const { data, error } = await sb.rpc(rpcName);
      if (error) {
        stoppedReason = "rpc_error";
        failure = error.message ?? "unknown error";
        break;
      }

      const deleted = Number(data ?? 0);
      if (!Number.isFinite(deleted) || deleted < 0) {
        stoppedReason = "rpc_error";
        failure = `invalid purge row count: ${String(data)}`;
        break;
      }

      rowsPurged += deleted;
      batches += 1;

      if (deleted < batchSize) {
        complete = true;
        stoppedReason = "drained";
        break;
      }
    }

    results.push({
      table,
      rpcName,
      rowsPurged,
      batches,
      complete,
      stoppedReason,
      ...(failure ? { error: failure } : {}),
    });
  }

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
