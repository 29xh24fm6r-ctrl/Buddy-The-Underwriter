import "server-only";

type LedgerEvent = {
  stage: string;
  status: string;
  created_at: string;
  payload?: Record<string, any>;
};

/**
 * getLatestLedgerEvent - Get most recent pipeline event
 * 
 * Read-only helper for displaying recent activity.
 * Used in UI snippets to build trust ("the system is working").
 * 
 * @param events - Array of ledger events (sorted desc by created_at)
 * @returns Latest event or null
 */
export function getLatestLedgerEvent(events: LedgerEvent[] | null | undefined): LedgerEvent | null {
  if (!events || events.length === 0) {
    return null;
  }
  
  return events[0];
}

/**
 * formatLedgerEventTime - Human-friendly relative time
 * 
 * Examples:
 * - "Just now"
 * - "2 minutes ago"
 * - "1 hour ago"
 * - "Yesterday"
 */
export function formatLedgerEventTime(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes === 1) return "1 minute ago";
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  if (diffHours === 1) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}
