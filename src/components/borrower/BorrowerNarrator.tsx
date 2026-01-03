import type { DealMode } from "@/lib/deals/dealMode";

// Align narrator mode with canonical DealMode
export type BorrowerNarratorMode = DealMode;

export function BorrowerNarrator({
  mode,
  remainingCount,
}: {
  mode: BorrowerNarratorMode;
  remainingCount: number;
}) {
  const messages: Record<BorrowerNarratorMode, string> = {
    initializing: "We’re getting things ready for you…",
    processing: "We’re reviewing what you’ve uploaded so far.",
    needs_input:
      remainingCount > 0
        ? `You’re almost there — just ${remainingCount} item${
            remainingCount === 1 ? "" : "s"
          } left.`
        : "You’re almost there — just a bit more information needed.",
    ready: "You’re all set! Nothing else is needed right now.",
    blocked:
      "We need a little more information before we can move forward.",
  };

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      {messages[mode]}
    </div>
  );
}
