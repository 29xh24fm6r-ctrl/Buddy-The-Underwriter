/**
 * Bounded nightly telemetry retention.
 *
 * Every RPC invocation deletes at most one database batch and therefore
 * commits independently. The application invokes a capped number of batches
 * per table so a large backlog cannot monopolize one database transaction or
 * exhaust the nightly function's execution window.
 */

type RpcResult = { data: unknown; error: { message?: string } | null };
type InsertResult = { error?: { message?: string } | null };
type SB = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<InsertResult>;
  };
};

const PURGE_RPCS = [
  { rpcName: "purge_buddy_system_events", table: "buddy_system_events" },
  { rpcName: "purge_franchise_sync_runs", table: "franchise_sync_runs" },
  { rpcName: "purge_buddy_workers", table: "buddy_workers" },
] as const;

export const RETENTION_BATCH_SIZE = 5_000;
export const MAX_RETENTION_BATCHES_PER_TABLE = 10;

export type PurgeResult = {
  table: string;
  rpcName: string;
  rowsPurged: number;
  batches: number;
  drained: boolean;
};

export type PurgeFailure = {
  table: string;
  rpcName: string;
  error: string;
};

export class TelemetryRetentionPurgeError extends Error {
  override readonly name = "TelemetryRetentionPurgeError";

  constructor(
    readonly results: PurgeResult[],
    readonly failures: PurgeFailure[],
  ) {
    super(
      `Telemetry retention failed for ${failures
        .map((failure) => `${failure.table}: ${failure.error}`)
        .join("; ")}`,
    );
  }
}

function parseDeletedRows(data: unknown, rpcName: string): number {
  const deleted = Number(data ?? 0);
  if (
    !Number.isSafeInteger(deleted) ||
    deleted < 0 ||
    deleted > RETENTION_BATCH_SIZE
  ) {
    throw new Error(
      `retention RPC "${rpcName}" returned invalid batch count: ${String(data)}`,
    );
  }
  return deleted;
}

/**
 * Drains at most 50,000 rows from each table per nightly run. A failure for one
 * table does not starve the remaining tables, but the aggregate result still
 * fails loudly after every independent retention path has been attempted.
 */
export async function runTelemetryRetentionPurge(
  sb: SB,
): Promise<PurgeResult[]> {
  const results: PurgeResult[] = [];
  const failures: PurgeFailure[] = [];

  for (const { rpcName, table } of PURGE_RPCS) {
    let rowsPurged = 0;
    let batches = 0;
    let drained = false;

    try {
      while (batches < MAX_RETENTION_BATCHES_PER_TABLE) {
        const { data, error } = await sb.rpc(rpcName);
        if (error) {
          throw new Error(error.message ?? "unknown error");
        }

        const deleted = parseDeletedRows(data, rpcName);
        rowsPurged += deleted;
        batches++;

        if (deleted < RETENTION_BATCH_SIZE) {
          drained = true;
          break;
        }
      }
    } catch (error) {
      failures.push({
        table,
        rpcName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    results.push({ table, rpcName, rowsPurged, batches, drained });
  }

  const eventType =
    failures.length === 0
      ? "telemetry_retention_purge_completed"
      : "telemetry_retention_purge_failed";
  const insertResult = await sb.from("buddy_system_events").insert({
    event_type: eventType,
    severity: failures.length === 0 ? "info" : "error",
    source_system: "nightly-cron",
    payload: { results, failures },
  });

  if (insertResult?.error) {
    failures.push({
      table: "buddy_system_events",
      rpcName: "retention_result_event",
      error: insertResult.error.message ?? "unknown insert error",
    });
  }

  if (failures.length > 0) {
    throw new TelemetryRetentionPurgeError(results, failures);
  }

  return results;
}
