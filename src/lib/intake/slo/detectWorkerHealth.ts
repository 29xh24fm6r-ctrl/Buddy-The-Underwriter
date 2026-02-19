/**
 * Detect Worker Health — Governance Monitor
 *
 * Queries intake_worker_health_v1. For each worker with health_color = 'red',
 * emits intake.worker_unhealthy into deal_events (dealId = "system").
 *
 * Called from: observer tick / ops cron
 * Fire-and-forget: never throws, always swallows errors.
 *
 * Every emitted event includes detection_version for audit trail stability.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DETECTION_VERSION = "detect_v1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WorkerHealthRow = {
  worker_id: string | null;
  worker_type: string | null;
  status: string | null;
  seconds_since_heartbeat: number | null;
  consecutive_failures: number | null;
  health_color: string | null;
};

// ---------------------------------------------------------------------------
// detectWorkerHealth — fire-and-forget, never throws
// ---------------------------------------------------------------------------

/**
 * Scans intake_worker_health_v1 for red workers.
 * Emits intake.worker_unhealthy for each one.
 */
export async function detectWorkerHealth(): Promise<void> {
  try {
    const sb = supabaseAdmin();

    const { data, error } = await (sb as any)
      .from("intake_worker_health_v1")
      .select("*")
      .eq("health_color", "red");

    if (error) {
      console.warn("[detectWorkerHealth] query error (non-fatal):", error);
      return;
    }

    if (!data || data.length === 0) return;

    const rows: WorkerHealthRow[] = data;

    for (const row of rows) {
      try {
        await writeEvent({
          dealId: "system",
          kind: "intake.worker_unhealthy",
          actorUserId: null,
          scope: "intake",
          action: "worker_unhealthy",
          confidence: 1.0,
          meta: {
            worker_id: row.worker_id,
            worker_type: row.worker_type,
            seconds_since_heartbeat: row.seconds_since_heartbeat,
            consecutive_failures: row.consecutive_failures,
            detection_version: DETECTION_VERSION,
          },
        });

        console.log(
          `[detectWorkerHealth] Unhealthy worker detected: ${row.worker_id} (${row.worker_type}) — ${row.seconds_since_heartbeat}s since heartbeat`,
        );
      } catch (e) {
        console.warn("[detectWorkerHealth] event emit failed (non-fatal):", e);
      }
    }
  } catch (e) {
    // Fire-and-forget — never propagates
    console.warn("[detectWorkerHealth] unexpected error (non-fatal):", e);
  }
}
