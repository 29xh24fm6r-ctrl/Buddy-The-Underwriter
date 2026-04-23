import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeSystemEvent } from "@/lib/aegis";

/**
 * Reconciles orphan spread placeholders that have no backing job.
 *
 * An orphan is a `deal_spreads` row where:
 *   - status = 'queued'
 *   - started_at IS NULL  (never picked up)
 *   - updated_at < NOW() - stale_threshold_minutes
 *   - NO active `deal_spread_jobs` row exists for the deal+bank
 *
 * Marks each orphan 'error' with code ORPHANED_BY_FAILED_ORCHESTRATION.
 * Idempotent; safe to run from a worker tick.
 */
export async function cleanupOrphanSpreads(opts?: {
  staleThresholdMinutes?: number;
}): Promise<{ ok: boolean; cleaned: number; error?: string }> {
  const sb = supabaseAdmin();
  const threshold = opts?.staleThresholdMinutes ?? 5;

  try {
    const { data: orphans, error } = await (sb as any).rpc("find_orphan_spreads", {
      stale_threshold_minutes: threshold,
    });

    if (error) return { ok: false, cleaned: 0, error: error.message };
    if (!orphans || orphans.length === 0) return { ok: true, cleaned: 0 };

    const ids = orphans.map((o: any) => o.id);
    const { error: updateErr } = await (sb as any)
      .from("deal_spreads")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error: "Orphaned by failed orchestration; no backing job found",
        error_code: "ORPHANED_BY_FAILED_ORCHESTRATION",
        updated_at: new Date().toISOString(),
      })
      .in("id", ids);

    if (updateErr) return { ok: false, cleaned: 0, error: updateErr.message };

    writeSystemEvent({
      event_type: "warning",
      severity: "warning",
      source_system: "spreads_janitor",
      error_class: "transient",
      error_code: "ORPHANED_BY_FAILED_ORCHESTRATION",
      error_message: `Cleaned ${orphans.length} orphan spread placeholder(s)`,
      payload: {
        cleaned_count: orphans.length,
        sample_ids: ids.slice(0, 10),
        stale_threshold_minutes: threshold,
      },
    }).catch(() => {});

    return { ok: true, cleaned: orphans.length };
  } catch (e: any) {
    return { ok: false, cleaned: 0, error: e?.message ?? "unknown" };
  }
}
