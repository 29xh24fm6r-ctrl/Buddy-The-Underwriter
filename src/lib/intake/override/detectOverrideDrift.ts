/**
 * Override Drift Detector — Institutional Alert Layer
 *
 * Queries override_drift_v1 for the current week and emits
 * intake.override_drift_detected ledger events for any (from, to) pair
 * with delta >= DRIFT_SPIKE_THRESHOLD.
 *
 * Buddy alerts — it does not auto-patch.
 *
 * Called from: admin observer tick / ops cron
 * Fire-and-forget: never throws, always swallows errors.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Week-over-week delta that triggers a drift alert */
export const DRIFT_SPIKE_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DriftRow = {
  week_start: string | null;
  from_type: string | null;
  to_type: string | null;
  classifier_source: string | null;
  classification_version: string | null;
  weekly_count: number | null;
  prev_week_count: number | null;
  delta: number | null;
};

// ---------------------------------------------------------------------------
// detectOverrideDrift — fire-and-forget, never throws
// ---------------------------------------------------------------------------

/**
 * Scans current-week override_drift_v1 rows. For each with delta >= threshold,
 * emits intake.override_drift_detected into deal_events.
 *
 * Note: intake.override_drift_detected has no deal_id (system-level event).
 * We write to deal_events with dealId=null using a system sentinel.
 */
export async function detectOverrideDrift(): Promise<void> {
  try {
    const sb = supabaseAdmin();

    // Pull current week rows with significant delta
    const { data, error } = await (sb as any)
      .from("override_drift_v1")
      .select("*")
      .gte("delta", DRIFT_SPIKE_THRESHOLD)
      .order("delta", { ascending: false });

    if (error) {
      console.warn("[detectOverrideDrift] query error (non-fatal):", error);
      return;
    }

    if (!data || data.length === 0) return;

    const rows: DriftRow[] = data;

    // Emit one ledger event per spike
    for (const row of rows) {
      try {
        // Filter to current week only (view returns historical, we alert on current week)
        const weekStart = row.week_start ? new Date(row.week_start) : null;
        if (!weekStart) continue;

        const now = new Date();
        const startOfCurrentWeek = new Date(now);
        startOfCurrentWeek.setUTCDate(now.getUTCDate() - now.getUTCDay()); // Sunday
        startOfCurrentWeek.setUTCHours(0, 0, 0, 0);

        if (weekStart < startOfCurrentWeek) continue;

        await writeEvent({
          dealId: "system",                 // system-level alert — no specific deal
          kind: "intake.override_drift_detected",
          actorUserId: null,
          scope: "intake",
          action: "override_drift_detected",
          confidence: 1.0,
          meta: {
            from_type: row.from_type,
            to_type: row.to_type,
            delta: row.delta,
            weekly_count: row.weekly_count,
            prev_week_count: row.prev_week_count,
            dominant_classifier_source: row.classifier_source,
            classification_version: row.classification_version,
            week_start: row.week_start,
            threshold: DRIFT_SPIKE_THRESHOLD,
          },
        });

        console.log(
          `[detectOverrideDrift] Drift spike detected: ${row.from_type} → ${row.to_type} delta=${row.delta}`,
        );
      } catch (e) {
        console.warn("[detectOverrideDrift] event emit failed (non-fatal):", e);
      }
    }
  } catch (e) {
    // Fire-and-forget — never propagates
    console.warn("[detectOverrideDrift] unexpected error (non-fatal):", e);
  }
}
