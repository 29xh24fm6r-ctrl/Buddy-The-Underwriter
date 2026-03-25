"use client";

import { useState, useEffect } from "react";

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

const GAP_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  missing_fact:   { label: "Missing",     color: "bg-rose-500/20 text-rose-300" },
  conflict:       { label: "Conflict",    color: "bg-orange-500/20 text-orange-300" },
  low_confidence: { label: "Low confidence", color: "bg-amber-500/20 text-amber-300" },
};

const REASON_LABEL: Record<string, string> = {
  missing_fact:   "Required metric not found in any uploaded document.",
  conflict:       "Conflicting values found across source documents.",
  low_confidence: "Extracted with low confidence — banker judgment needed.",
};

function formatPeriod(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) {
    const y1 = start.slice(0, 4);
    const y2 = end.slice(0, 4);
    return y1 === y2 ? `FY${y1}` : `${y1}–${y2}`;
  }
  return start ? `FY${start.slice(0, 4)}` : `FY${end!.slice(0, 4)}`;
}

export default function DealHealthPanel({ dealId, onSessionStart }: DealHealthPanelProps) {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [completeness, setCompleteness] = useState<number>(0);
  const [snapshotExists, setSnapshotExists] = useState<boolean | null>(null);
  const [provenance, setProvenance] = useState<Record<string, Provenance>>({});
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

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

  const confirmFact = async (gap: Gap) => {
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

  // Filter to only evidence-backed review items (low_confidence + conflict).
  // missing_fact items always show (they are action items, not confirmations).
  const reviewableGaps = gaps.filter(
    g => g.gap_type === "missing_fact" || g.gap_type === "conflict" || g.gap_type === "low_confidence",
  );

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
            Start Credit Interview
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

      {/* Review items */}
      <div className="divide-y divide-white/5">
        {reviewableGaps.map(gap => {
          const badge = GAP_TYPE_BADGE[gap.gap_type] ?? { label: gap.gap_type, color: "bg-white/10 text-white/50" };
          const prov = gap.fact_id ? provenance[gap.fact_id] : null;
          const period = prov ? formatPeriod(prov.periodStart, prov.periodEnd) : null;
          const reason = REASON_LABEL[gap.gap_type] ?? "Banker judgment needed.";

          return (
            <div key={gap.id} className="px-4 py-3">
              {/* Top row: badge + key + action */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.color}`}>
                      {badge.label}
                    </span>
                    <span className="text-xs font-mono text-white/40">{gap.fact_key}</span>
                    {period && (
                      <span className="text-[10px] text-white/30">{period}</span>
                    )}
                  </div>
                  <p className="text-xs text-white/50 leading-relaxed">{gap.description}</p>
                </div>

                {/* Action button — only for low_confidence with fact_id (evidence-backed) */}
                {gap.gap_type === "low_confidence" && gap.fact_id && prov && (
                  <button
                    onClick={() => confirmFact(gap)}
                    disabled={resolving === gap.id}
                    className="flex-shrink-0 text-xs font-semibold text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded transition-colors disabled:opacity-50"
                  >
                    {resolving === gap.id ? "..." : "Confirm value"}
                  </button>
                )}
              </div>

              {/* Evidence block — only render if provenance exists */}
              {prov && (
                <div className="mt-2 ml-0 pl-3 border-l border-white/10 space-y-0.5">
                  {prov.value != null && (
                    <div className="text-[11px] text-white/40">
                      <span className="text-white/25">Value:</span>{" "}
                      <span className="text-white/60 font-medium">
                        ${Number(prov.value).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  )}
                  {prov.sourceDocumentName && (
                    <div className="text-[11px] text-white/40">
                      <span className="text-white/25">Source:</span>{" "}
                      <span className="text-white/50">{prov.sourceDocumentName}</span>
                    </div>
                  )}
                  {prov.confidence != null && (
                    <div className="text-[11px] text-white/40">
                      <span className="text-white/25">Confidence:</span>{" "}
                      <span className="text-white/50">{Math.round(prov.confidence * 100)}%</span>
                    </div>
                  )}
                  <div className="text-[11px] text-white/30 italic">{reason}</div>
                </div>
              )}

              {/* For missing_fact — no evidence, just action guidance */}
              {gap.gap_type === "missing_fact" && !prov && (
                <div className="mt-1.5 text-[11px] text-white/30 italic">{reason}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
