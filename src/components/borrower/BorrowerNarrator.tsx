/**
 * BorrowerNarrator — System's calm voice for borrowers
 * 
 * SOFTER than banker narrator:
 * - "I'm reviewing..." (not "deal is processing...")
 * - "I still need..." (not "missing 3 items")
 * - Zero jargon, pure guidance
 * 
 * UX Goal: Borrowers feel guided, not managed
 */

import { DealMode } from "@/lib/deals/dealMode";

interface BorrowerNarratorProps {
  mode: DealMode;
  remainingCount: number;
}

export function BorrowerNarrator({ mode, remainingCount }: BorrowerNarratorProps) {
  const scripts: Record<DealMode, string> = {
    initializing: "I'm reviewing what you've uploaded so far.",
    needs_input:
      remainingCount > 0
        ? `I still need ${remainingCount} item${remainingCount > 1 ? "s" : ""}.`
        : "I'm checking everything now.",
    processing: "Your documents are processing. No action needed.",
    ready: "You're all set. Nothing else is needed right now.",
    blocked: "I need a little more information before moving forward.",
  };

  const colorClasses: Record<DealMode, string> = {
    initializing: "bg-amber-900/20 text-amber-200",
    needs_input: "bg-blue-900/20 text-blue-200",
    processing: "bg-blue-900/20 text-blue-200",
    ready: "bg-emerald-900/20 text-emerald-200",
    blocked: "bg-red-900/20 text-red-200",
  };

  return (
    <div
      className={`rounded-xl px-5 py-4 text-sm ${colorClasses[mode]}`}
      role="status"
      aria-live="polite"
    >
      {scripts[mode]}
    </div>
  );
}
