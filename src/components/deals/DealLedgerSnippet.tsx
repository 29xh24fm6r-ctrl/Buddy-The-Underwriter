"use client";

import { formatLedgerEventTime } from "@/lib/deals/getLatestLedgerEvent";

type LedgerEvent = {
  stage: string;
  status: string;
  created_at: string;
  payload?: Record<string, any>;
};

type DealLedgerSnippetProps = {
  event: LedgerEvent | null;
};

/**
 * DealLedgerSnippet - Subtle timeline breadcrumb
 * 
 * Shows most recent system activity to build trust.
 * Non-interactive, read-only.
 * 
 * Examples:
 * - "2 minutes ago: auto_seed completed"
 * - "Just now: checklist reconciled"
 * 
 * Purpose: Answer "Did the system actually do anything?"
 */
export function DealLedgerSnippet({ event }: DealLedgerSnippetProps) {
  if (!event) {
    return null;
  }

  const relativeTime = formatLedgerEventTime(event.created_at);
  const activity = `${event.stage} ${event.status}`;

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
      <div className="h-1 w-1 rounded-full bg-slate-400" />
      <span className="font-medium">{relativeTime}:</span>
      <span>{activity}</span>
    </div>
  );
}
