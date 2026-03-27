"use client";

import type { OmegaAdvisoryState } from "@/core/omega/types";

export function OmegaConfidenceBadge({ omega }: { omega: OmegaAdvisoryState }) {
  if (omega.confidence < 0 && omega.stale) {
    return null; // Omega not available — don't show anything
  }

  const conf = omega.confidence;
  const color = omega.stale
    ? "border-neutral-400/30 bg-neutral-500/20 text-neutral-300"
    : conf >= 80
      ? "border-emerald-500/30 bg-emerald-600/20 text-emerald-300"
      : conf >= 50
        ? "border-amber-500/30 bg-amber-600/20 text-amber-200"
        : "border-red-500/30 bg-red-600/20 text-red-200";

  return (
    <div
      data-testid="omega-confidence-badge"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${color}`}
      title={omega.stale ? `Advisory may be outdated: ${omega.staleReason ?? "unknown"}` : `Omega confidence: ${conf}%`}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
        {omega.stale ? "hourglass_empty" : "psychology"}
      </span>
      {omega.stale ? "Advisory outdated" : `${conf}% confidence`}
    </div>
  );
}
