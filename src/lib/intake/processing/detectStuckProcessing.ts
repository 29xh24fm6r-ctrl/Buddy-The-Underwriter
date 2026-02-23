/**
 * Pure stuck-detection function for intake processing runs.
 *
 * No server-only, no DB — safe to import from CI guards and client code.
 * Deterministic: takes timestamps + nowMs, returns stuck verdict.
 */

import {
  MAX_PROCESSING_WINDOW_MS,
  MAX_QUEUE_TO_START_MS,
  MAX_HEARTBEAT_STALE_MS,
} from "@/lib/intake/constants";

// ── Types ──────────────────────────────────────────────────────────────

export type ProcessingRunMarkers = {
  intake_phase: string | null;
  intake_processing_queued_at: string | null;
  intake_processing_started_at: string | null;
  intake_processing_last_heartbeat_at: string | null;
  intake_processing_run_id: string | null;
};

export type StuckReason =
  | "queued_never_started"  // queued_at set, started_at null, gap > 2min
  | "heartbeat_stale"       // last heartbeat > 3min ago
  | "overall_timeout"       // total elapsed > 5min (belt-and-suspenders)
  | "legacy_no_markers";    // CONFIRMED but no queued_at (pre-observability)

export type StuckVerdict =
  | { stuck: false }
  | { stuck: true; reason: StuckReason; age_ms: number };

export const STUCK_DETECTION_VERSION = "stuck_v1";

// ── Detection ──────────────────────────────────────────────────────────

/**
 * Determines whether a processing run is stuck based on run markers.
 *
 * Only applies when intake_phase === "CONFIRMED_READY_FOR_PROCESSING".
 * Check order: legacy_no_markers → queued_never_started → heartbeat_stale → overall_timeout.
 *
 * @param markers         - The run marker columns from the deals row
 * @param nowMs           - Current time in milliseconds (injected for determinism)
 * @param confirmedSinceMs - Optional epoch ms when deal entered CONFIRMED phase.
 *                           When provided, legacy_no_markers only fires if confirmed
 *                           for longer than MAX_QUEUE_TO_START_MS (prevents false
 *                           positives on freshly-confirmed pre-observability deals).
 */
export function detectStuckProcessing(
  markers: ProcessingRunMarkers,
  nowMs: number,
  confirmedSinceMs?: number,
): StuckVerdict {
  // Only applies to CONFIRMED phase
  if (markers.intake_phase !== "CONFIRMED_READY_FOR_PROCESSING") {
    return { stuck: false };
  }

  const queuedAt = markers.intake_processing_queued_at;
  const startedAt = markers.intake_processing_started_at;
  const lastHeartbeat = markers.intake_processing_last_heartbeat_at;

  // 1. Legacy run — CONFIRMED but no queued_at means pre-observability.
  //    Time-guarded when confirmedSinceMs is provided to prevent false positives
  //    on deals that were just confirmed before observability columns were populated.
  if (!queuedAt) {
    if (confirmedSinceMs != null) {
      const confirmedAge = nowMs - confirmedSinceMs;
      if (confirmedAge > MAX_QUEUE_TO_START_MS) {
        return { stuck: true, reason: "legacy_no_markers", age_ms: confirmedAge };
      }
      return { stuck: false };
    }
    // No confirmedSinceMs → immediate detection (backward compat)
    return { stuck: true, reason: "legacy_no_markers", age_ms: 0 };
  }

  const queuedMs = new Date(queuedAt).getTime();

  // 2. Queued but never started — cold start failure or crash before processConfirmedIntake
  if (!startedAt) {
    const queueAge = nowMs - queuedMs;
    if (queueAge > MAX_QUEUE_TO_START_MS) {
      return { stuck: true, reason: "queued_never_started", age_ms: queueAge };
    }
    return { stuck: false };
  }

  // 3. Heartbeat stale — processing started but heartbeat stopped updating
  if (lastHeartbeat) {
    const heartbeatAge = nowMs - new Date(lastHeartbeat).getTime();
    if (heartbeatAge > MAX_HEARTBEAT_STALE_MS) {
      return { stuck: true, reason: "heartbeat_stale", age_ms: heartbeatAge };
    }
  }

  // 4. Overall timeout — belt-and-suspenders against the full processing window
  const totalAge = nowMs - queuedMs;
  if (totalAge > MAX_PROCESSING_WINDOW_MS) {
    return { stuck: true, reason: "overall_timeout", age_ms: totalAge };
  }

  return { stuck: false };
}
