import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeSystemEvent } from "@/lib/aegis";

/**
 * SPEC-SPREAD-PIPELINE-RECOVERY-1 — fails jobs wedged in RUNNING.
 *
 * A `deal_spread_jobs` row stuck in status='RUNNING' with no progress (updated_at
 * older than the threshold) blocks all downstream spread rendering for the deal:
 * the worker won't claim new work while an active job exists, and the orphan
 * janitor can't reconcile the deal's queued spreads. This marks such jobs 'FAILED'
 * so the next orchestration (and orphan reconciliation) can proceed.
 *
 * Runs BEFORE cleanupOrphanSpreads on each worker tick so stuck jobs are cleared
 * first and orphan detection then runs on clean state. Idempotent; the status
 * guard on UPDATE prevents racing a job that legitimately finished mid-scan.
 */
export async function cleanupStuckJobs(opts?: {
  stuckThresholdMinutes?: number;
}): Promise<{ ok: boolean; cleaned: number; error?: string }> {
  const sb = supabaseAdmin();
  const threshold = opts?.stuckThresholdMinutes ?? 30;
  const cutoff = new Date(Date.now() - threshold * 60_000).toISOString();

  try {
    const { data: stuck, error } = await (sb as any)
      .from("deal_spread_jobs")
      .select("id, deal_id, bank_id")
      .eq("status", "RUNNING")
      .lt("updated_at", cutoff);

    if (error) return { ok: false, cleaned: 0, error: error.message };
    if (!stuck || stuck.length === 0) return { ok: true, cleaned: 0 };

    let cleaned = 0;
    for (const job of stuck) {
      const { error: updErr } = await (sb as any)
        .from("deal_spread_jobs")
        .update({
          status: "FAILED",
          error: `Stuck in RUNNING for >${threshold}min; auto-failed by SPEC-SPREAD-PIPELINE-RECOVERY-1`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("status", "RUNNING"); // guard against racing a legitimate completion
      if (!updErr) cleaned += 1;
    }

    if (cleaned > 0) {
      writeSystemEvent({
        event_type: "warning",
        severity: "warning",
        source_system: "spreads_janitor",
        error_class: "transient",
        error_code: "SPREAD_JOB_STUCK_AUTO_FAILED",
        error_message: `Auto-failed ${cleaned} stuck spread job(s)`,
        payload: {
          cleaned_count: cleaned,
          sample_ids: stuck.slice(0, 10).map((j: any) => j.id),
          stuck_threshold_minutes: threshold,
        },
      }).catch(() => {});
    }

    return { ok: true, cleaned };
  } catch (e: any) {
    return { ok: false, cleaned: 0, error: e?.message ?? "unknown" };
  }
}
