"use client";

import type { BuddyExplanation } from "@/core/explanation/types";

export function DealExplanationPanel({
  explanation,
}: {
  explanation: BuddyExplanation;
}) {
  return (
    <div
      data-testid="deal-explanation-panel"
      className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3"
    >
      {/* Summary */}
      <div className="text-sm font-medium text-neutral-900">
        {explanation.summary}
      </div>

      {/* Reasons */}
      {explanation.reasons.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 mb-1">
            Why
          </div>
          <ul className="space-y-0.5">
            {explanation.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-neutral-700">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Blocking factors */}
      {explanation.blockingFactors.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-red-500 mb-1">
            Blocking
          </div>
          <ul className="space-y-0.5">
            {explanation.blockingFactors.map((b, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-red-700">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Supporting facts */}
      {explanation.supportingFacts.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">
            Facts
          </div>
          <ul className="space-y-0.5">
            {explanation.supportingFacts.map((f, i) => (
              <li key={i} className="text-[11px] text-neutral-500">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
