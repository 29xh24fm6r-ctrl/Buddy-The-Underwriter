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
 *
 * Two stall reasons:
 *   "never_claimed_timeout"  — claimed_at=null, attempts=0, age > threshold.
 *                              The cron never ran or is misconfigured.
 *   "stale_claim_expired"    — claimed_at is set but older than OUTBOX_CLAIM_TTL_MS,
 *                              attempts=0, delivered_at=null. A consumer claimed the
 *                              row but crashed before calling markFailed(), so the
 *                              attempt counter was never incremented.
 */

// ── Pure detection (no server-only, safe for CI guards) ────────────────

export const OUTBOX_STALL_THRESHOLD_MS = 120_000; // 2 minutes — never-claimed window
export const OUTBOX_CLAIM_TTL_MS = 300_000;       // 5 minutes — matches p_claim_ttl_seconds in consumer
export const OUTBOX_STALL_VERSION = "outbox_stall_v1";

export type OutboxRowState = {
  id: string;
  attempts: number;
  claimed_at: string | null;
  claim_owner: string | null;
  delivered_at: string | null;
  dead_lettered_at: string | null;
  created_at: string;
};

export type OutboxStallVerdict =
  | { stalled: false }
  | { stalled: true; reason: "never_claimed_timeout"; outbox_id: string; age_seconds: number }
  | { stalled: true; reason: "stale_claim_expired";  outbox_id: string; age_seconds: number; claim_owner: string | null };

/**
 * Pure function: determines if an outbox row is stalled.
 *
 * Stalled = (attempts=0 AND delivered_at=NULL AND dead_lettered_at=NULL) AND EITHER:
 *   (a) claimed_at=null AND age > thresholdMs  → "never_claimed_timeout"
 *   (b) claimed_at set AND claim age > claimTtlMs → "stale_claim_expired"
 */
export function isOutboxStalled(
  row: OutboxRowState,
  nowMs: number,
  thresholdMs: number = OUTBOX_STALL_THRESHOLD_MS,
  claimTtlMs: number = OUTBOX_CLAIM_TTL_MS,
): OutboxStallVerdict {
  if (row.delivered_at)     return { stalled: false };
  if (row.dead_lettered_at) return { stalled: false };
  if (row.attempts > 0)     return { stalled: false };

  if (row.claimed_at) {
    const claimAgeMs = nowMs - new Date(row.claimed_at).getTime();
    if (claimAgeMs < claimTtlMs) return { stalled: false }; // legitimately in-flight
    // Claim TTL expired with no attempts increment — consumer crashed before markFailed
    return {
      stalled: true,
      reason: "stale_claim_expired",
      outbox_id: row.id,
      age_seconds: Math.round((nowMs - new Date(row.created_at).getTime()) / 1000),
      claim_owner: row.claim_owner,
    };
  }

  const ageMs = nowMs - new Date(row.created_at).getTime();
  if (ageMs < thresholdMs) return { stalled: false };

  return {
    stalled: true,
    reason: "never_claimed_timeout",
    outbox_id: row.id,
    age_seconds: Math.round(ageMs / 1000),
  };
}
