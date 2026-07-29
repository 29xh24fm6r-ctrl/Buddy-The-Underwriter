/**
 * SPEC-SYSTEM-DEBLOAT-1 Phase B — Telemetry retention (B2 fallback path).
 *
 * pg_cron is not installed on this project, so the three purge RPCs
 * authored in supabase/migrations/20260729000000_telemetry_retention.sql
 * are invoked here, from the nightly cron job, instead of via pg_cron.
 *
 * RPC existence in prod is Matt-verified at migration-apply time, not
 * assumed by this code — a missing RPC is a loud failure (throws), not a
 * skipped step.
 */

type RpcResult = { data: unknown; error: { message?: string } | null };
type SB = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<unknown> };
};

const PURGE_RPCS = [
  { rpcName: "purge_buddy_system_events", table: "buddy_system_events" },
  { rpcName: "purge_franchise_sync_runs", table: "franchise_sync_runs" },
  { rpcName: "purge_buddy_workers", table: "buddy_workers" },
] as const;

export type PurgeResult = { table: string; rpcName: string; rowsPurged: number };

/** Invokes all three retention-purge RPCs in order. Throws on the first
 *  RPC error (including "function does not exist") rather than silently
 *  skipping it. */
export async function runTelemetryRetentionPurge(sb: SB): Promise<PurgeResult[]> {
  const results: PurgeResult[] = [];

  for (const { rpcName, table } of PURGE_RPCS) {
    const { data, error } = await sb.rpc(rpcName);
    if (error) {
      throw new Error(
        `telemetry retention purge RPC "${rpcName}" failed (table: ${table}): ${error.message ?? "unknown error"}`,
      );
    }
    results.push({ table, rpcName, rowsPurged: Number(data ?? 0) });
  }

  await sb.from("buddy_system_events").insert({
    event_type: "telemetry_retention_purge_completed",
    severity: "info",
    source_system: "nightly-cron",
    payload: { results },
  });

  return results;
}
