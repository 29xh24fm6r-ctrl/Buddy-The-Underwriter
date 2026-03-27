"use client";

import { useState } from "react";
import type { OmegaExplanation } from "@/core/explanation/types";

/**
 * Omega Trace Drawer — Phase 65C
 *
 * Builder-mode only. Shows Omega reasoning traces.
 * RULES:
 * - Never exposed to borrower
 * - Feature flag: NEXT_PUBLIC_OMEGA_TRACE_ENABLED
 * - No raw JSON dump — always formatted
 */

export function OmegaTraceDrawer({
  omegaExplanation,
  builderMode = false,
}: {
  omegaExplanation: OmegaExplanation;
  builderMode?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Only show in builder mode with trace enabled
  const traceEnabled = typeof window !== "undefined"
    && process.env.NEXT_PUBLIC_OMEGA_TRACE_ENABLED === "true";

  if (!builderMode || !traceEnabled) return null;
  if (!omegaExplanation.traceRef) return null;

  return (
    <div data-testid="omega-trace-drawer">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] text-blue-600 hover:text-blue-800 underline"
      >
        {open ? "Hide reasoning" : "View reasoning"}
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          {omegaExplanation.stale && (
            <div className="rounded bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700">
              Warning: This trace may be outdated
            </div>
          )}

          <div className="text-xs text-neutral-700">
            <span className="font-medium">Advisory: </span>
            {omegaExplanation.advisorySummary}
          </div>

          <div className="text-xs text-neutral-700">
            <span className="font-medium">Confidence: </span>
            {omegaExplanation.confidence >= 0 ? `${omegaExplanation.confidence}%` : "Unavailable"}
          </div>

          {omegaExplanation.signals.length > 0 && (
            <div>
              <div className="text-[10px] font-medium text-neutral-500 mb-1">
                Signal drivers:
              </div>
              <ul className="space-y-0.5">
                {omegaExplanation.signals.map((s, i) => (
                  <li key={i} className="text-[11px] text-neutral-600">
                    - {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="text-[10px] font-mono text-neutral-400">
            Trace ref: {omegaExplanation.traceRef}
          </div>
        </div>
      )}
    </div>
  );
}
