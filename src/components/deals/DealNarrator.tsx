import type { DealMode } from "@/lib/deals/dealMode";

type DealNarratorProps = {
  mode: DealMode;
  detail?: string | null;
};

/**
 * DealNarrator
 *
 * Purpose:
 * - Calm, authoritative system voice
 * - Explains what is happening, not what the user must do
 * - Never panics, never asks questions
 *
 * This is the "Holy crap, this feels handled" moment.
 */
export function DealNarrator({ mode, detail }: DealNarratorProps) {
  const copy: Record<DealMode, { tone: string; text: string }> = {
    initializing: {
      tone: "neutral",
      text: "We’re setting things up and reviewing your documents.",
    },
    processing: {
      tone: "calm",
      text: "Your documents are processing. Everything updates automatically.",
    },
    needs_input: {
      tone: "guidance",
      text: detail
        ? `A few required items are still missing: ${detail}`
        : "A few required items are still missing.",
    },
    blocked: {
      tone: "firm",
      text: detail
        ? `We can’t move forward yet: ${detail}`
        : "We can’t move forward yet. A blocking issue needs attention.",
    },
    ready: {
      tone: "positive",
      text: "This deal is complete and ready to move forward.",
    },
  };

  const message = copy[mode];

  return (
    <div
      className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
      role="status"
      aria-live="polite"
    >
      {message.text}
    </div>
  );
}
