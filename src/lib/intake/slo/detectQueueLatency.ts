/**
 * Detect Queue Latency — Governance Monitor
 *
 * Queries intake_queue_latency_v1. For each row with health_color = 'red',
 * emits intake.queue_backlog_detected into deal_events (dealId = "system").
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

type QueueLatencyRow = {
  job_type: string | null;
  queued_count: number | null;
  max_queue_age_seconds: number | null;
  health_color: string | null;
};

// ---------------------------------------------------------------------------
// detectQueueLatency — fire-and-forget, never throws
// ---------------------------------------------------------------------------

/**
 * Scans intake_queue_latency_v1 for red queue entries.
 * Emits intake.queue_backlog_detected for each stalled job type.
 */
export async function detectQueueLatency(): Promise<void> {
  try {
    const sb = supabaseAdmin();

    const { data, error } = await (sb as any)
      .from("intake_queue_latency_v1")
      .select("*")
      .eq("health_color", "red");

    if (error) {
      console.warn("[detectQueueLatency] query error (non-fatal):", error);
      return;
    }

    if (!data || data.length === 0) return;

    const rows: QueueLatencyRow[] = data;

    for (const row of rows) {
      try {
        await writeEvent({
          dealId: "system",
          kind: "intake.queue_backlog_detected",
          actorUserId: null,
          scope: "intake",
          action: "queue_backlog_detected",
          confidence: 1.0,
          meta: {
            job_type: row.job_type,
            queued_count: row.queued_count,
            max_queue_age_seconds: row.max_queue_age_seconds,
            detection_version: DETECTION_VERSION,
          },
        });

        console.log(
          `[detectQueueLatency] Queue backlog detected: ${row.job_type} — ${row.queued_count} queued, oldest ${row.max_queue_age_seconds}s`,
        );
      } catch (e) {
        console.warn("[detectQueueLatency] event emit failed (non-fatal):", e);
      }
    }
  } catch (e) {
    // Fire-and-forget — never propagates
    console.warn("[detectQueueLatency] unexpected error (non-fatal):", e);
  }
}
