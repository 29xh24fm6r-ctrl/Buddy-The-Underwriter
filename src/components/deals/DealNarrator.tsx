import type { DealMode } from "@/lib/deals/dealMode";

export function DealNarrator({
  mode,
  detail,
}: {
  mode: DealMode;
  detail?: string | null;
}) {
  const script: Record<DealMode, { tone: "amber" | "blue" | "green" | "red"; text: string }> = {
    initializing: {
      tone: "amber",
      text: "I'm building the checklist from your uploaded documents.",
    },
    processing: {
      tone: "blue",
      text: "Documents are processing. I'll update everything automatically.",
    },
    needs_input: {
      tone: "amber",
      text: detail ? `I'm missing a few required items: ${detail}` : "I'm missing a few required items.",
    },
    blocked: {
      tone: "red",
      text: detail ? `I can't move forward yet — ${detail}` : "I can't move forward yet.",
    },
    ready: {
      tone: "green",
      text: "✅ This deal is complete and ready to move forward.",
    },
  };

  const { tone, text } = script[mode];

  const toneClass =
    tone === "red"
      ? "bg-red-500/10 text-red-300 border-red-500/20"
      : tone === "green"
      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
      : tone === "blue"
      ? "bg-sky-500/10 text-sky-300 border-sky-500/20"
      : "bg-amber-500/10 text-amber-200 border-amber-500/20";

  return (
    <div className={`rounded-xl border px-5 py-4 text-sm leading-relaxed ${toneClass}`}>
      {text}
    </div>
  );
}
