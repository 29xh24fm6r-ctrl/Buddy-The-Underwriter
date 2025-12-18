/**
 * Borrower Automation: Stall Detection Rules
 * 
 * Determines when a condition is "stalled" based on:
 * 1. No borrower activity for N days
 * 2. No condition evaluation change for N days
 * 
 * These thresholds are configurable and deterministic.
 */

export interface StallInput {
  lastBorrowerActivityAt: string | null;
  lastEvaluatedAt: string | null;
  now: Date;
}

export interface StallResult {
  stalled: boolean;
  reason: "no_recent_borrower_activity" | "no_recent_condition_change" | null;
}

/**
 * Compute stall status for a condition
 */
export function computeStall({
  lastBorrowerActivityAt,
  lastEvaluatedAt,
  now,
}: StallInput): StallResult {
  const days = (d: Date) => Math.floor(d.getTime() / 86400000);
  const today = days(now);

  const act = lastBorrowerActivityAt ? days(new Date(lastBorrowerActivityAt)) : null;
  const evald = lastEvaluatedAt ? days(new Date(lastEvaluatedAt)) : null;

  // Deterministic stall thresholds (tune later)
  const STALL_IF_NO_ACTIVITY_DAYS = 5;
  const STALL_IF_NO_CHANGE_DAYS = 7;

  const noActivity = act === null ? true : today - act >= STALL_IF_NO_ACTIVITY_DAYS;
  const noChange = evald === null ? true : today - evald >= STALL_IF_NO_CHANGE_DAYS;

  if (noActivity) return { stalled: true, reason: "no_recent_borrower_activity" };
  if (noChange) return { stalled: true, reason: "no_recent_condition_change" };
  return { stalled: false, reason: null };
}

/**
 * Throttle enforcement: max 2 nudges per 7 days per condition
 */
export function shouldThrottle({
  sendCount,
  lastSentAt,
  now,
}: {
  sendCount: number;
  lastSentAt: string | null;
  now: Date;
}): boolean {
  const MAX_SENDS_PER_WINDOW = 2;
  const WINDOW_DAYS = 7;

  if (!lastSentAt) return false; // No throttle if never sent

  const daysSinceLastSent = Math.floor(
    (now.getTime() - new Date(lastSentAt).getTime()) / 86400000
  );

  if (daysSinceLastSent >= WINDOW_DAYS) {
    // Outside window, reset
    return false;
  }

  // Within window: check count
  return sendCount >= MAX_SENDS_PER_WINDOW;
}
