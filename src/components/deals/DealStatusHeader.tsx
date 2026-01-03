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
 * Shows ONE truth in calm, plain language.
 * 
 * Color rules (SACRED):
 * - Red: blocked ONLY (requires immediate attention)
 * - Green: ready (can proceed)
 * - Amber: all intermediate states (system working or needs input)
 * 
 * Optional: Shows latest ledger event to build trust
 */
export function DealStatusHeader({ mode, latestEvent }: DealStatusHeaderProps) {
  const copy: Record<DealMode, string> = {
    initializing: "Initializing checklist from uploaded documents…",
    processing: "Documents processing — underwriting will unlock automatically",
    needs_input: "Action required: missing required documents",
    ready: "Deal ready for underwriting",
    blocked: "Deal blocked — attention required",
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

  return (
    <div>
      <div
        className={`rounded-lg border px-4 py-3 text-sm font-medium ${tone[mode]}`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">
            {icon[mode]}
          </span>
          <span>{copy[mode]}</span>
        </div>
      </div>
      {latestEvent && <DealLedgerSnippet event={latestEvent} />}
    </div>
  );
}
