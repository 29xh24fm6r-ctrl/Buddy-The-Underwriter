"use client";

import type { DealMode } from "@/lib/deals/dealMode";

export function TestControlPanel({
  onSimulate,
}: {
  onSimulate?: (mode: DealMode) => void;
}) {
  const handleSimulate = onSimulate ?? ((mode: DealMode) => {
    console.log("[TestControlPanel] Simulated mode:", mode);
  });

  const modes: DealMode[] = ["initializing", "processing", "needs_input", "ready", "blocked"];

  return (
    <div className="fixed bottom-4 right-4 z-50 w-56 rounded-xl border border-slate-800 bg-black/80 p-3 text-xs text-white shadow-xl backdrop-blur">
      <div className="mb-2 font-semibold">Test Buddy</div>
      <div className="grid grid-cols-2 gap-2">
        {modes.map((m) => (
          <button
            key={m}
            onClick={() => handleSimulate(m)}
            className="rounded-lg bg-slate-800 px-2 py-1 hover:bg-slate-700"
          >
            {m}
          </button>
        ))}
      </div>
      <div className="mt-2 text-[10px] text-slate-400">In-memory only · no DB writes</div>
    </div>
  );
}
