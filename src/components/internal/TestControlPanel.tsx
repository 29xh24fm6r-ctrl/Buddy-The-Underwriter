/**
 * TestControlPanel — Safe state exploration
 * 
 * VISIBLE ONLY TO INTERNAL USERS
 * 
 * Lets you:
 * - Cycle through every DealMode
 * - Test every banner
 * - Validate every page
 * - Demo without lying
 * 
 * Does NOT:
 * - Mutate database
 * - Affect real users
 * - Leak into production
 */

"use client";

import { DealMode } from "@/lib/deals/dealMode";

interface TestControlPanelProps {
  onSimulate: (mode: DealMode | null) => void;
  currentMode: DealMode;
  simulatedMode?: DealMode | null;
}

export function TestControlPanel({
  onSimulate,
  currentMode,
  simulatedMode,
}: TestControlPanelProps) {
  const modes: Array<{ mode: DealMode; label: string }> = [
    { mode: "initializing", label: "Initializing" },
    { mode: "needs_input", label: "Needs Input" },
    { mode: "processing", label: "Processing" },
    { mode: "ready", label: "Ready" },
    { mode: "blocked", label: "Blocked" },
  ];

  return (
    <div className="fixed bottom-4 right-4 rounded-xl bg-black/90 p-4 text-xs text-white shadow-xl border border-slate-700">
      <div className="mb-3 font-semibold text-amber-400">🧪 Test Buddy</div>

      <div className="space-y-2">
        <div className="text-slate-400 text-[10px] uppercase tracking-wide">
          Real: {currentMode}
        </div>

        {simulatedMode && (
          <div className="text-blue-400 text-[10px] uppercase tracking-wide">
            Simulated: {simulatedMode}
          </div>
        )}

        <div className="border-t border-slate-700 pt-2 mt-2 space-y-1">
          {modes.map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => onSimulate(mode)}
              className={`
                w-full rounded px-2 py-1 text-left text-xs transition-colors
                ${
                  simulatedMode === mode
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={() => onSimulate(null)}
          className="w-full rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600 mt-2"
        >
          Reset to Real
        </button>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-700 text-[10px] text-slate-500">
        No DB mutations • Safe testing
      </div>
    </div>
  );
}
