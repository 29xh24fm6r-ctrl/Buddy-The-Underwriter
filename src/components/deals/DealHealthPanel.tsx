"use client";

import { useState, useEffect } from "react";
import FinancialReviewItem from "@/components/deals/financial-review/FinancialReviewItem";

type Gap = {
  id: string;
  gap_type: "missing_fact" | "low_confidence" | "conflict";
  fact_key: string;
  description: string;
  resolution_prompt: string;
  priority: number;
  fact_id: string | null;
  conflict_id: string | null;
};

type Provenance = {
  value: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  confidence: number | null;
  sourceDocumentName: string | null;
  sourceLineLabel: string | null;
  extractionPath: string | null;
};

type DealHealthPanelProps = {
  dealId: string;
  onSessionStart?: () => void;
};

/** Deterministic sort: conflict → missing_fact → low_confidence, then by priority desc, then fact_key asc */
const GAP_TYPE_ORDER: Record<string, number> = { conflict: 0, missing_fact: 1, low_confidence: 2 };

function sortReviewItems(gaps: Gap[]): Gap[] {
  return [...gaps].sort((a, b) => {
    const typeA = GAP_TYPE_ORDER[a.gap_type] ?? 9;
    const typeB = GAP_TYPE_ORDER[b.gap_type] ?? 9;
    if (typeA !== typeB) return typeA - typeB;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.fact_key.localeCompare(b.fact_key);
  });
}

export default function DealHealthPanel({ dealId, onSessionStart }: DealHealthPanelProps) {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [completeness, setCompleteness] = useState<number>(0);
  const [snapshotExists, setSnapshotExists] = useState<boolean | null>(null);
  const [provenance, setProvenance] = useState<Record<string, Provenance>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/deals/${dealId}/gap-queue`);
    const data = await res.json();
    if (data.ok) {
      setGaps(data.gaps);
      setCompleteness(data.completenessScore);
      setSnapshotExists(data.financialSnapshotExists ?? false);
      setProvenance(data.provenance ?? {});
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [dealId]);

  const barColor = completeness >= 80 ? "bg-emerald-500" :
                   completeness >= 50 ? "bg-amber-500" : "bg-rose-500";

  if (loading) return (
    <div className="border border-white/10 rounded-lg p-4 animate-pulse bg-white/[0.03]">
      <div className="h-4 bg-white/10 rounded w-1/3 mb-3" />
      <div className="h-2 bg-white/10 rounded" />
    </div>
  );

  // ── STATE A: No snapshot yet ──────────────────────────────────────────
  if (!snapshotExists) {
    return (
      <div className="border border-white/10 rounded-lg overflow-hidden bg-white/[0.03]">
        <div className="px-4 py-3 bg-white/[0.04] border-b border-white/10">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">
            Financial Validation
          </span>
        </div>
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-white/50 mb-1">
            No banker review needed yet.
          </p>
          <p className="text-xs text-white/35 mb-4 max-w-sm mx-auto leading-relaxed">
            Buddy has not assembled a reviewable financial snapshot with supporting evidence.
            Upload financial statements, complete spreads, and generate the snapshot first.
          </p>
          <a
            href={`/deals/${dealId}/cockpit`}
            className="inline-block text-xs font-semibold bg-white/10 text-white/70 px-3 py-1.5 rounded-md hover:bg-white/15 transition-colors"
          >
            Go to Financials
          </a>
        </div>
      </div>
    );
  }

  // Filter to only evidence-backed review items, sorted by underwriting urgency:
  // conflict → missing_fact → low_confidence
  const reviewableGaps = sortReviewItems(gaps.filter(
    g => g.gap_type === "missing_fact" || g.gap_type === "conflict" || g.gap_type === "low_confidence",
  ));

  // ── STATE C: Snapshot ready, no exceptions ────────────────────────────
  if (reviewableGaps.length === 0) {
    return (
      <div className="border border-white/10 rounded-lg overflow-hidden bg-white/[0.03]">
        <div className="px-4 py-3 bg-white/[0.04] border-b border-white/10 flex items-center justify-between">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">
            Financial Validation
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
            No review needed
          </span>
        </div>
        {/* Completeness bar */}
        <div className="px-4 py-3 border-b border-white/5">
          <div className="flex items-center justify-between text-xs text-white/40 mb-1.5">
            <span>Data completeness</span>
            <span className="font-semibold text-white/60">{completeness}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className={`h-1.5 ${barColor} rounded-full transition-all`} style={{ width: `${completeness}%` }} />
          </div>
        </div>
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-white/50">
            Buddy has assembled a reviewable financial snapshot.
          </p>
          <p className="text-xs text-white/35 mt-1">
            No banker review is currently required.
          </p>
        </div>
      </div>
    );
  }

  // ── STATE D: Snapshot ready, items require banker judgment ─────────────
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden bg-white/[0.03]">
      {/* Header */}
      <div className="px-4 py-3 bg-white/[0.04] border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">
            Financial Validation
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            reviewableGaps.length <= 2 ? "bg-amber-500/20 text-amber-300" : "bg-rose-500/20 text-rose-300"
          }`}>
            {reviewableGaps.length} item{reviewableGaps.length !== 1 ? "s" : ""} need{reviewableGaps.length === 1 ? "s" : ""} review
          </span>
        </div>
        {onSessionStart && (
          <button
            onClick={onSessionStart}
            className="text-xs font-semibold bg-white/10 text-white/70 px-3 py-1.5 rounded-md hover:bg-white/15 flex items-center gap-1.5 transition-colors"
          >
            Start Financial Review
          </button>
        )}
      </div>

      {/* Completeness bar */}
      <div className="px-4 py-3 border-b border-white/5">
        <div className="flex items-center justify-between text-xs text-white/40 mb-1.5">
          <span>Data completeness</span>
          <span className="font-semibold text-white/60">{completeness}%</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className={`h-1.5 ${barColor} rounded-full transition-all`} style={{ width: `${completeness}%` }} />
        </div>
      </div>

      {/* Review items — each with full action workflow */}
      <div className="divide-y divide-white/5">
        {reviewableGaps.map(gap => (
          <FinancialReviewItem
            key={gap.id}
            gap={gap}
            provenance={gap.fact_id ? provenance[gap.fact_id] ?? null : null}
            dealId={dealId}
            onResolved={load}
          />
        ))}
      </div>
    </div>
  );
}
