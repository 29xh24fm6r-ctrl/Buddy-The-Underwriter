"use client";

import React from "react";
import type {
  RiskDeltaAnalysis,
  RiskDeltaDriver,
  RiskImpact,
} from "@/lib/creditMemo/intelligence/types";

const OVERALL_BADGE: Record<RiskDeltaAnalysis["overall"], string> = {
  improving: "bg-emerald-100 text-emerald-800 border-emerald-200",
  deteriorating: "bg-rose-100 text-rose-800 border-rose-200",
  neutral: "bg-gray-100 text-gray-700 border-gray-200",
};

const IMPACT_TONE: Record<RiskImpact, string> = {
  positive: "text-emerald-700",
  negative: "text-rose-700",
  neutral: "text-gray-600",
};

const ARROW: Record<RiskDeltaDriver["direction"], string> = {
  up: "↑",
  down: "↓",
  unchanged: "→",
  added: "＋",
  removed: "−",
};

export default function RiskDeltaPanel({
  riskDelta,
}: {
  riskDelta: RiskDeltaAnalysis | null;
}) {
  if (!riskDelta) {
    return (
      <section className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Risk Delta</h2>
        <p className="mt-1 text-xs text-gray-500 italic">
          No prior submitted version to compare. Risk delta will appear once a second
          version is submitted.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="text-sm font-semibold text-gray-900">Risk Delta</h2>
        <span
          className={`text-[10px] font-semibold border rounded px-2 py-0.5 ${OVERALL_BADGE[riskDelta.overall]}`}
        >
          {riskDelta.overall}
        </span>
      </div>
      <p className="text-xs text-gray-700 mb-3">{riskDelta.recommendation_shift}</p>

      <div className="grid gap-2">
        {riskDelta.drivers.map((d) => (
          <div
            key={d.factor}
            className="flex items-start gap-3 rounded border border-gray-200 px-3 py-2"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-900">{d.factor}</span>
                <span className={`text-[11px] font-mono ${IMPACT_TONE[d.impact]}`}>
                  {ARROW[d.direction]} {d.impact}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-gray-600">{d.explanation}</div>
            </div>
            <div className="text-right shrink-0 font-mono text-[11px] text-gray-700">
              <div>{formatVal(d.before)}</div>
              <div className="text-gray-400">→</div>
              <div className={IMPACT_TONE[d.impact]}>{formatVal(d.after)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 text-[10px] font-mono text-gray-500">
        Materiality: {riskDelta.materiality}
      </div>
    </section>
  );
}

function formatVal(v: number | string | null): string {
  if (v === null) return "—";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2);
  }
  return v;
}
