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
}): Promise<{ ok: boolean; cleaned: number; healed?: number; error?: string }> {
  const sb = supabaseAdmin();
  const threshold = opts?.staleThresholdMinutes ?? 5;

  try {
    // SPEC-SPREAD-PIPELINE-RECOVERY-2: a row that already carries rendered_json
    // was rendered by a completed job and only lost its status flip. It is
    // healed to 'ready', never errored — erroring it flipped the deal's
    // canonical memo status to "error" and hid a perfectly good spread.
    const healed = await healRenderedStaleSpreads(sb, threshold);

    const { data: orphans, error } = await (sb as any).rpc("find_orphan_spreads", {
      stale_threshold_minutes: threshold,
    });

    if (error) return { ok: false, cleaned: 0, healed, error: error.message };
    if (!orphans || orphans.length === 0) return { ok: true, cleaned: 0, healed };

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
      .in("id", ids)
      // Belt-and-braces with the RPC: never error a rendered spread.
      .is("rendered_json", null);

    if (updateErr) return { ok: false, cleaned: 0, healed, error: updateErr.message };

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

    return { ok: true, cleaned: orphans.length, healed };
  } catch (e: any) {
    return { ok: false, cleaned: 0, error: e?.message ?? "unknown" };
  }
}

/**
 * Flip rendered-but-never-finalized spreads ('queued'/'generating' with
 * rendered_json present, no active job) to 'ready'. Returns the number healed.
 * Best-effort: a missing RPC (migration not yet applied) heals nothing.
 */
async function healRenderedStaleSpreads(
  sb: ReturnType<typeof supabaseAdmin>,
  staleThresholdMinutes: number,
): Promise<number> {
  try {
    const { data: rows, error } = await (sb as any).rpc("find_rendered_stale_spreads", {
      stale_threshold_minutes: staleThresholdMinutes,
    });
    if (error || !rows || rows.length === 0) return 0;

    const ids = rows.map((r: any) => r.id);
    const now = new Date().toISOString();
    const { error: updErr } = await (sb as any)
      .from("deal_spreads")
      .update({
        status: "ready",
        error: null,
        error_code: null,
        error_details_json: null,
        finished_at: now,
        updated_at: now,
      })
      .in("id", ids)
      .in("status", ["queued", "generating"])
      .not("rendered_json", "is", null);
    if (updErr) return 0;

    writeSystemEvent({
      event_type: "info",
      severity: "info",
      source_system: "spreads_janitor",
      error_class: "transient",
      error_code: "SPREAD_RENDERED_STALE_HEALED",
      error_message: `Healed ${ids.length} rendered-but-stale spread(s) to ready`,
      payload: {
        healed_count: ids.length,
        sample_ids: ids.slice(0, 10),
        stale_threshold_minutes: staleThresholdMinutes,
      },
    }).catch(() => {});

    return ids.length;
  } catch {
    return 0;
  }
}
