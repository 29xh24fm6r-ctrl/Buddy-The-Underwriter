"use client";

import { useEffect, useState } from "react";

type GateData = {
  snapshotPresent: boolean;
  snapshotStatus: string | null;
  financialBlockers: string[];
  memoSafe: boolean;
  decisionSafe: boolean;
};

type Readiness = {
  snapshotStatus: string;
  completenessPercent: number;
  reviewRequired: boolean;
  nextRecommendedAction: string | null;
};

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  validated: { label: "Validated", color: "bg-emerald-100 text-emerald-700" },
  partially_validated: { label: "Partially Validated", color: "bg-blue-100 text-blue-700" },
  needs_review: { label: "Needs Review", color: "bg-amber-100 text-amber-700" },
  generated: { label: "Generated", color: "bg-gray-100 text-gray-700" },
  stale: { label: "Stale", color: "bg-red-100 text-red-700" },
  collecting_inputs: { label: "Collecting", color: "bg-gray-100 text-gray-500" },
  not_started: { label: "Not Started", color: "bg-gray-100 text-gray-400" },
  superseded: { label: "Superseded", color: "bg-gray-100 text-gray-400" },
};

export function FinancialSnapshotGateCard({ dealId }: { dealId: string }) {
  const [data, setData] = useState<{ snapshot: any; readiness: Readiness } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/financial-validation`);
        const json = await res.json();
        if (json?.ok) {
          setData({ snapshot: json.snapshot, readiness: json.readiness });
        }
      } catch { /* degrade gracefully */ }
      finally { setLoading(false); }
    })();
  }, [dealId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 animate-pulse">
        <div className="h-4 bg-white/10 rounded w-1/3 mb-2" />
        <div className="h-2 bg-white/10 rounded w-2/3" />
      </div>
    );
  }

  if (!data || !data.snapshot) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white/50 uppercase tracking-wide">Financial Snapshot</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400">Not Started</span>
        </div>
        <p className="text-xs text-white/40 mt-2">Upload financial documents to begin snapshot generation.</p>
      </div>
    );
  }

  const { readiness } = data;
  const status = readiness.snapshotStatus;
  const badge = STATUS_BADGES[status] ?? STATUS_BADGES.not_started;
  const memoSafe = status === "validated" || status === "partially_validated";
  const decisionSafe = status === "validated";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-white/50 uppercase tracking-wide">Financial Snapshot</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
      </div>

      {/* Completeness bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-xs text-white/40 mb-1">
          <span>Completeness</span>
          <span>{readiness.completenessPercent}%</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all ${readiness.completenessPercent >= 90 ? "bg-emerald-500" : readiness.completenessPercent >= 50 ? "bg-amber-500" : "bg-red-500"}`}
            style={{ width: `${readiness.completenessPercent}%` }}
          />
        </div>
      </div>

      {/* Safety indicators */}
      <div className="flex items-center gap-3 text-[10px] mb-2">
        <span className={memoSafe ? "text-emerald-400" : "text-red-400"}>
          Memo: {memoSafe ? "Safe" : "Blocked"}
        </span>
        <span className={decisionSafe ? "text-emerald-400" : "text-red-400"}>
          Decision: {decisionSafe ? "Safe" : "Blocked"}
        </span>
      </div>

      {/* Next action */}
      {readiness.nextRecommendedAction && (
        <p className="text-xs text-white/50 mb-2">{readiness.nextRecommendedAction}</p>
      )}

      {/* CTA */}
      <a
        href={`/deals/${dealId}/financial-validation`}
        className="inline-flex items-center gap-1 text-xs font-semibold text-white/60 hover:text-white/80"
      >
        Open Financial Validation
        <span className="material-symbols-outlined text-[12px]">arrow_forward</span>
      </a>
    </div>
  );
}
