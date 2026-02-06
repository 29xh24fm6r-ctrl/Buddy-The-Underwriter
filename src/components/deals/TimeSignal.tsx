"use client";

import { useState, useEffect } from "react";

type TimeSignalProps = {
  timestamp: string | null;
};

function formatRelativeTime(ts: string): string {
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
}

/**
 * TimeSignal - Subtle timestamp whisper
 *
 * Eliminates anxiety about staleness.
 * Shows when data was last updated.
 *
 * Builds trust without demanding attention.
 */
export function TimeSignal({ timestamp }: TimeSignalProps) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!timestamp) return;
    setLabel(formatRelativeTime(timestamp));
    const id = setInterval(() => setLabel(formatRelativeTime(timestamp)), 30_000);
    return () => clearInterval(id);
  }, [timestamp]);

  if (!timestamp || !label) return null;

  return (
    <div className="mt-2 text-xs text-slate-500">
      {label}
    </div>
  );
}
