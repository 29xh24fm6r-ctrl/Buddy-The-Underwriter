"use client";

import type { DriftSummary } from "@/lib/underwritingLaunch/types";

interface Props {
  drift: DriftSummary;
  onReviewDrift: () => void;
  onRefresh: () => void;
}

export default function DriftBanner({ drift, onReviewDrift, onRefresh }: Props) {
  if (!drift.hasDrift) return null;

  const isMaterial = drift.severity === "material";

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        isMaterial
          ? "border-red-500/30 bg-red-500/10"
          : "border-amber-500/30 bg-amber-500/10"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="material-symbols-outlined shrink-0"
              style={{ fontSize: 18, color: isMaterial ? "#f87171" : "#fbbf24" }}
            >
              warning
            </span>
            <span className={`text-sm font-semibold ${isMaterial ? "text-red-300" : "text-amber-300"}`}>
              {isMaterial ? "Material intake drift detected" : "Intake has changed since launch"}
            </span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {drift.items.map((item, i) => (
              <li key={i} className="text-xs text-white/60">
                {item.summary}
                {item.impact === "all_underwriting" && (
                  <span className="ml-1 text-red-300/70">(all workstreams)</span>
                )}
                {item.impact === "spreads" && (
                  <span className="ml-1 text-amber-300/70">(spreads)</span>
                )}
                {item.impact === "memo" && (
                  <span className="ml-1 text-amber-300/70">(memo)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onReviewDrift}
            className="rounded border border-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/5"
          >
            Review Drift
          </button>
          {isMaterial && (
            <button
              onClick={onRefresh}
              className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
            >
              Refresh Underwriting
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
