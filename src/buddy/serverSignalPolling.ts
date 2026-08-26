export const BUDDY_SIGNAL_ACTIVE_POLL_MS = 2_500;
export const BUDDY_SIGNAL_IDLE_POLL_MAX_MS = 60_000;
export const BUDDY_SIGNAL_ERROR_POLL_MAX_MS = 30_000;
export const BUDDY_SIGNAL_ROUTE_TIMEOUT_MS = 8_000;
export const BUDDY_SIGNAL_FETCH_TIMEOUT_MS = 10_000;

type PollDelayInput = {
  consecutiveErrors: number;
  consecutiveEmptyPolls: number;
};

/**
 * Keep the observer responsive while signals are active, then rapidly shed
 * read load when a page is idle. Errors use their own capped backoff so a
 * degraded database is not hammered by every open browser tab.
 */
export function getBuddySignalPollDelay({
  consecutiveErrors,
  consecutiveEmptyPolls,
}: PollDelayInput): number {
  if (consecutiveErrors > 0) {
    return Math.min(
      BUDDY_SIGNAL_ACTIVE_POLL_MS * Math.pow(2, consecutiveErrors),
      BUDDY_SIGNAL_ERROR_POLL_MAX_MS,
    );
  }

  if (consecutiveEmptyPolls > 0) {
    return Math.min(
      BUDDY_SIGNAL_ACTIVE_POLL_MS * Math.pow(2, consecutiveEmptyPolls),
      BUDDY_SIGNAL_IDLE_POLL_MAX_MS,
    );
  }

  return BUDDY_SIGNAL_ACTIVE_POLL_MS;
}
