"use client";

import { useState } from "react";
import type { DealMode } from "@/lib/deals/dealMode";

/**
 * TestControlPanel
 *
 * Internal-only panel for simulating deal convergence states.
 * This does NOT affect the database or real users.
 */
export function TestControlPanel() {
  const [simulatedMode, setSimulatedMode] = useState<DealMode | null>(null);

  const modes: { mode: DealMode; label: string }[] = [
    { mode: "initializing", label: "Initializing" },
    { mode: "processing", label: "Processing" },
    { mode: "needs_input", label: "Needs input" },
    { mode: "ready", label: "Ready" },
    { mode: "blocked", label: "Blocked" },
  ];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        Internal test controls
      </div>

      <div className="mb-3 text-xs text-slate-600">
        Simulate deal convergence states for UX testing only.
      </div>

      <div className="flex flex-wrap gap-2">
        {modes.map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => setSimulatedMode(mode)}
            className={`rounded px-2 py-1 text-xs transition ${
              simulatedMode === mode
                ? "bg-slate-900 text-white"
                : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
            }`}
          >
            {label}
          </button>
        ))}

        <button
          onClick={() => setSimulatedMode(null)}
          className="rounded px-2 py-1 text-xs border border-slate-300 text-slate-500 hover:bg-slate-100"
        >
          Reset
        </button>
      </div>

      {simulatedMode && (
        <div className="mt-3 text-xs text-slate-600">
          Simulating mode:{" "}
          <span className="font-semibold text-slate-900">
            {simulatedMode}
          </span>
        </div>
      )}
    </div>
  );
}
