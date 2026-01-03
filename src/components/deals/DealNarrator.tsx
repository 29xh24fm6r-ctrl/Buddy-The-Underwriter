"use client";

import type { DealMode } from "@/lib/deals/dealMode";

type DealNarratorProps = {
  mode: DealMode;
  detail?: string;
};

/**
 * DealNarrator - The system's calm, confident voice
 * 
 * Replaces ALL banners, statuses, and color guessing.
 * Tells users what IS happening, not what they need to interpret.
 * 
 * This creates the "holy crap, this is easy" moment.
 * 
 * Script principles:
 * - First person ("I'm reviewing...")
 * - Present tense (happening now)
 * - Calm, confident tone
 * - Explains reality, doesn't ask questions
 */
export function DealNarrator({ mode, detail }: DealNarratorProps) {
  const script: Record<DealMode, { tone: string; text: string }> = {
    initializing: {
      tone: "amber",
      text: "I'm reviewing the documents you've uploaded and building the checklist.",
    },
    processing: {
      tone: "blue",
      text: "Documents are processing. I'll update everything automatically.",
    },
    needs_input: {
      tone: "amber",
      text: detail 
        ? `I'm missing a few required items: ${detail}` 
        : "I'm missing a few required items.",
    },
    blocked: {
      tone: "red",
      text: detail 
        ? `I can't move forward yet — ${detail}` 
        : "I can't move forward yet.",
    },
    ready: {
      tone: "green",
      text: "This deal is complete and ready to move forward.",
    },
  };

  const { tone, text } = script[mode];

  const toneClass: Record<string, string> = {
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    blue: "bg-sky-500/10 text-sky-300 border-sky-500/20",
    green: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
  };

  return (
    <div 
      className={`rounded-xl border px-5 py-4 text-sm leading-relaxed ${toneClass[tone]}`}
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  );
}
