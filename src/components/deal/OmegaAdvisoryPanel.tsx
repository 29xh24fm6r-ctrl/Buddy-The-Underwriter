"use client";

import type { OmegaAdvisoryState } from "@/core/omega/types";

export function OmegaAdvisoryPanel({
  omega,
  builderMode = false,
}: {
  omega: OmegaAdvisoryState;
  builderMode?: boolean;
}) {
  // Don't render if no advisory content and not in builder mode
  if (!omega.advisory && !builderMode) return null;

  return (
    <div
      data-testid="omega-advisory-panel"
      className={`rounded-xl border p-4 ${
        omega.stale
          ? "border-neutral-200 bg-neutral-50"
          : "border-blue-200 bg-blue-50"
      }`}
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          psychology
        </span>
        Omega Advisory
        {omega.stale && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
            May be outdated
          </span>
        )}
      </div>

      {omega.advisory && (
        <p className="mt-2 text-sm text-neutral-700">{omega.advisory}</p>
      )}

      {omega.riskEmphasis.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {omega.riskEmphasis.map((signal, i) => (
            <span
              key={i}
              className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"
            >
              {signal}
            </span>
          ))}
        </div>
      )}

      {/* Builder-only trace link */}
      {builderMode && omega.traceRef && (
        <div className="mt-2 text-[10px] font-mono text-neutral-400">
          Trace: {omega.traceRef}
        </div>
      )}
    </div>
  );
}
