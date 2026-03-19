"use client";

import { useState, useEffect } from "react";

type Gap = {
  id: string;
  gap_type: "missing_fact" | "low_confidence" | "conflict" | "needs_confirmation";
  fact_key: string;
  description: string;
  resolution_prompt: string;
  priority: number;
  fact_id: string | null;
  conflict_id: string | null;
};

type DealHealthPanelProps = {
  dealId: string;
  onSessionStart?: () => void;
};

const GAP_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  missing_fact:       { label: "Missing",  color: "bg-rose-100 text-rose-700" },
  conflict:           { label: "Conflict", color: "bg-orange-100 text-orange-700" },
  low_confidence:     { label: "Unverified", color: "bg-amber-100 text-amber-700" },
  needs_confirmation: { label: "Confirm",  color: "bg-sky-100 text-sky-700" },
};

export default function DealHealthPanel({ dealId, onSessionStart }: DealHealthPanelProps) {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [completeness, setCompleteness] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/deals/${dealId}/gap-queue`);
    const data = await res.json();
    if (data.ok) {
      setGaps(data.gaps);
      setCompleteness(data.completenessScore);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [dealId]);

  const confirm = async (gap: Gap) => {
    if (!gap.fact_id) return;
    setResolving(gap.id);
    await fetch(`/api/deals/${dealId}/gap-queue/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm", factId: gap.fact_id }),
    });
    await load();
    setResolving(null);
  };

  const barColor = completeness >= 80 ? "bg-emerald-500" :
                   completeness >= 50 ? "bg-amber-500" : "bg-rose-500";

  if (loading) return (
    <div className="border border-gray-200 rounded-lg p-4 animate-pulse">
      <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
      <div className="h-2 bg-gray-100 rounded" />
    </div>
  );

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Deal Health</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            gaps.length === 0 ? "bg-emerald-100 text-emerald-700" :
            gaps.length <= 3 ? "bg-amber-100 text-amber-700" :
            "bg-rose-100 text-rose-700"
          }`}>
            {gaps.length === 0 ? "Complete" : `${gaps.length} open item${gaps.length !== 1 ? "s" : ""}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {gaps.length > 0 && onSessionStart && (
            <button
              onClick={onSessionStart}
              className="text-xs font-semibold bg-gray-900 text-white px-3 py-1.5 rounded-md hover:bg-gray-700 flex items-center gap-1.5"
            >
              Start Credit Interview
            </button>
          )}
        </div>
      </div>

      {/* Completeness bar */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
          <span>Data completeness</span>
          <span className="font-semibold text-gray-800">{completeness}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-1.5 ${barColor} rounded-full transition-all`} style={{ width: `${completeness}%` }} />
        </div>
      </div>

      {/* Gap list */}
      {gaps.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          All required facts confirmed
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {gaps.map(gap => {
            const badge = GAP_TYPE_BADGE[gap.gap_type] ?? { label: gap.gap_type, color: "bg-gray-100 text-gray-600" };
            return (
              <div key={gap.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.color}`}>
                      {badge.label}
                    </span>
                    <span className="text-xs font-mono text-gray-500">{gap.fact_key}</span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{gap.description}</p>
                </div>
                {gap.gap_type === "low_confidence" && gap.fact_id && (
                  <button
                    onClick={() => confirm(gap)}
                    disabled={resolving === gap.id}
                    className="flex-shrink-0 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded"
                  >
                    {resolving === gap.id ? "..." : "Confirm"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
