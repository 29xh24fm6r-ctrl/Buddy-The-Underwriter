import type { DealMode } from "@/lib/deals/dealMode";

export function BorrowerNarrator({
  mode,
  remainingCount,
}: {
  mode: DealMode;
  remainingCount: number;
}) {
  const script: Record<DealMode, string> = {
    initializing: "I'm reviewing what you've uploaded so far.",
    processing: "Your documents are processing. No action needed.",
    needs_input:
      remainingCount > 0
        ? `I still need ${remainingCount} item${remainingCount === 1 ? "" : "s"}.`
        : "I'm checking everything now.",
    blocked: "I need a little more information before moving forward.",
    ready: "You're all set. Nothing else is needed right now.",
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-5 py-4 text-sm text-slate-200">
      {script[mode]}
    </div>
  );
}
