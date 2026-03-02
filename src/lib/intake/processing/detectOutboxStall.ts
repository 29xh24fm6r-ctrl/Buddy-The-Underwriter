/**
 * Outbox stall detection for intake processing.
 *
 * Pure detection function (no server-only) + server-side emission function.
 *
 * Detects when an intake.process outbox row has NOT been picked up by any
 * consumer (attempts=0, delivered_at=NULL, age > threshold). This is distinct
 * from stuck-processing detection (detectStuckProcessing.ts) which detects
 * when a consumer PICKED UP the row but processing stalled.
 *
 * Stall detection catches the case where NO consumer is running at all
 * (e.g. local dev without `npm run worker:intake`, or prod cron failure).
 */

// ── Pure detection (no server-only, safe for CI guards) ────────────────

export const OUTBOX_STALL_THRESHOLD_MS = 120_000; // 2 minutes
export const OUTBOX_STALL_VERSION = "outbox_stall_v1";

export type OutboxRowState = {
  id: string;
  attempts: number;
  claimed_at: string | null;
  delivered_at: string | null;
  dead_lettered_at: string | null;
  created_at: string;
};

export type OutboxStallVerdict =
  | { stalled: false }
  | { stalled: true; outbox_id: string; age_seconds: number };

/**
 * Pure function: determines if an outbox row is stalled.
 *
 * Stalled = attempts=0 AND delivered_at=NULL AND dead_lettered_at=NULL AND age > threshold.
 */
export function isOutboxStalled(
  row: OutboxRowState,
  nowMs: number,
  thresholdMs: number = OUTBOX_STALL_THRESHOLD_MS,
): OutboxStallVerdict {
  if (row.delivered_at) return { stalled: false };
  if (row.dead_lettered_at) return { stalled: false };
  if (row.attempts > 0) return { stalled: false };
  if (row.claimed_at) return { stalled: false }; // in-flight — consumer has it

  const ageMs = nowMs - new Date(row.created_at).getTime();
  if (ageMs < thresholdMs) return { stalled: false };

  return {
    stalled: true,
    outbox_id: row.id,
    age_seconds: Math.round(ageMs / 1000),
  };
}
