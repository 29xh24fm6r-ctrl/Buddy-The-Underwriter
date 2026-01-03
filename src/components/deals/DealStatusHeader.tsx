"use client";

import type { DealMode } from "@/lib/deals/dealMode";
import { DealLedgerSnippet } from "./DealLedgerSnippet";

type LedgerEvent = {
  stage: string;
  status: string;
  created_at: string;
  payload?: Record<string, any>;
};

type DealStatusHeaderProps = {
  mode: DealMode;
  latestEvent?: LedgerEvent | null;
};

/**
 * DealStatusHeader - Single canonical status display
 * 
 * Replaces all checklist banners, color-coded statuses, and guessing games.
 * Shows ONE truth in calm, plain language using narrated convergence.
 * 
 * Color rules (SACRED):
 * - Red: blocked ONLY (requires immediate attention)
 * - Green: ready (can proceed)
 * - Amber: all intermediate states (system working or needs input)
 * 
 * Never shows spinners. System narrates what it's doing in human language.
 * Optional: Shows latest ledger event to build trust.
 */
export function DealStatusHeader({ mode, latestEvent }: DealStatusHeaderProps) {
  // Narrated convergence - system explains itself
  const copy: Record<DealMode, { title: string; message: string }> = {
    initializing: {
      title: "Getting things ready",
      message: "I'm organizing your deal and preparing everything in the background.",
    },
    processing: {
      title: "Almost there",
      message: "Documents are processing and checklist items are being matched automatically.",
    },
    needs_input: {
      title: "Action required",
      message: "I'm missing a few required documents to continue.",
    },
    ready: {
      title: "Deal ready",
      message: "Everything is in place. You're clear to proceed.",
    },
    blocked: {
      title: "Action needed",
      message: "This deal requires immediate attention to move forward.",
    },
  };

  const tone: Record<DealMode, string> = {
    blocked: "bg-red-500/10 text-red-900 border-red-200",
    ready: "bg-green-500/10 text-green-900 border-green-200",
    initializing: "bg-amber-500/10 text-amber-900 border-amber-200",
    processing: "bg-amber-500/10 text-amber-900 border-amber-200",
    needs_input: "bg-amber-500/10 text-amber-900 border-amber-200",
  };

  const icon: Record<DealMode, string> = {
    blocked: "🚫",
    ready: "✅",
    initializing: "⏳",
    processing: "⚙️",
    needs_input: "📋",
  };

  const { title, message } = copy[mode];

  return (
    <div>
      <div
        className={`rounded-lg border px-4 py-3 ${tone[mode]}`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base" aria-hidden="true">
            {icon[mode]}
          </span>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <div className="text-sm pl-6">{message}</div>
      </div>
      {latestEvent && <DealLedgerSnippet event={latestEvent} />}
    </div>
  );
}
