"use client";

import React from "react";
import type { UnderwriterDecisionAnalytics as Analytics } from "@/lib/creditMemo/intelligence/types";

export default function UnderwriterDecisionAnalytics({
  analytics,
}: {
  analytics: Analytics;
}) {
  if (analytics.total_decisions === 0) {
    return (
      <section className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Decision Analytics</h2>
        <p className="mt-1 text-xs text-gray-500 italic">
          No underwriter decisions recorded yet for this deal.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">Decision Analytics</h2>

      <div className="grid grid-cols-4 gap-2 mb-3">
        <Stat label="Total" value={String(analytics.total_decisions)} tone="neutral" />
        <Stat
          label="Approved"
          value={String(analytics.approvals)}
          subValue={`${pct(analytics.approval_rate)}`}
          tone="positive"
        />
        <Stat
          label="Returned"
          value={String(analytics.returns)}
          subValue={`${pct(analytics.return_rate)}`}
          tone="warn"
        />
        <Stat label="Declined" value={String(analytics.declines)} tone="negative" />
      </div>

      {analytics.avg_cycles_to_final_decision !== null && (
        <div className="mb-3 text-[11px] text-gray-700">
          <span className="text-gray-500">Avg cycles to final decision: </span>
          <span className="font-mono text-gray-900">
            {analytics.avg_cycles_to_final_decision}
          </span>
        </div>
      )}

      {analytics.common_return_reasons.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-gray-600 uppercase mb-1">
            Common return reasons
          </div>
          <ul className="space-y-1">
            {analytics.common_return_reasons.map((r) => (
              <li
                key={r.reason}
                className="flex items-center justify-between gap-2 text-[11px] border border-gray-200 rounded px-2 py-1"
              >
                <span className="text-gray-800 truncate">{r.reason}</span>
                <span className="font-mono text-gray-500 shrink-0">×{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function Stat({
  label,
  value,
  subValue,
  tone,
}: {
  label: string;
  value: string;
  subValue?: string;
  tone: "positive" | "negative" | "warn" | "neutral";
}) {
  const toneCls =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "negative"
        ? "border-rose-200 bg-rose-50"
        : tone === "warn"
          ? "border-amber-200 bg-amber-50"
          : "border-gray-200 bg-gray-50";
  return (
    <div className={`rounded border ${toneCls} px-2 py-1.5`}>
      <div className="text-[10px] font-semibold text-gray-500 uppercase">{label}</div>
      <div className="text-sm font-mono font-semibold text-gray-900">{value}</div>
      {subValue && <div className="text-[10px] font-mono text-gray-500">{subValue}</div>}
    </div>
  );
}
