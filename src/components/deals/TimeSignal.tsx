"use client";

type TimeSignalProps = {
  timestamp: string | null;
};

/**
 * TimeSignal - Subtle timestamp whisper
 * 
 * Eliminates anxiety about staleness.
 * Shows when data was last updated.
 * 
 * Examples:
 * - "Updated just now"
 * - "Last update: 2 minutes ago"
 * 
 * Builds trust without demanding attention.
 */
export function TimeSignal({ timestamp }: TimeSignalProps) {
  if (!timestamp) {
    return null;
  }

  const formatRelativeTime = (ts: string): string => {
    const now = new Date();
    const then = new Date(ts);
    const diffMs = now.getTime() - then.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMinutes < 1) return "Updated just now";
    if (diffMinutes === 1) return "Last update: 1 minute ago";
    if (diffMinutes < 60) return `Last update: ${diffMinutes} minutes ago`;
    if (diffHours === 1) return "Last update: 1 hour ago";
    if (diffHours < 24) return `Last update: ${diffHours} hours ago`;
    return "Last update: over a day ago";
  };

  return (
    <div className="mt-2 text-xs text-slate-500">
      {formatRelativeTime(timestamp)}
    </div>
  );
}
