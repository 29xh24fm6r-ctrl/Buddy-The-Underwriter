"use client";

import { useEffect, useState, useCallback } from "react";
import { FinancialFactProvenanceViewer } from "./FinancialFactProvenanceViewer";
import { FinancialFactDecisionForm } from "./FinancialFactDecisionForm";

type Gap = {
  id: string;
  gap_type: "missing_fact" | "low_confidence" | "conflict";
  fact_key: string;
  description: string;
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

type SnapshotInfo = {
  exists: boolean;
  status: string | null;
  completenessPercent: number | null;
  openReviewItems: number;
  unresolvedConflicts: number;
  unresolvedMissingFacts: number;
  lastBuiltAt: string | null;
};

type LifecycleImpact = {
  stage: string | null;
  blocked: boolean;
  blockerCode: string | null;
  message: string | null;
};

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  validated: { label: "Validated", color: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30" },
  partially_validated: { label: "Partially Validated", color: "bg-blue-500/20 text-blue-300 border-blue-400/30" },
  needs_review: { label: "Needs Review", color: "bg-amber-500/20 text-amber-300 border-amber-400/30" },
  generated: { label: "Generated", color: "bg-white/10 text-white/70 border-white/20" },
  stale: { label: "Stale", color: "bg-red-500/20 text-red-300 border-red-400/30" },
  not_started: { label: "Not Started", color: "bg-white/10 text-white/40 border-white/10" },
};

export function FinancialValidationWorkbench({ dealId }: { dealId: string }) {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [provenance, setProvenance] = useState<Record<string, Provenance>>({});
  const [snapshot, setSnapshot] = useState<SnapshotInfo | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [expandedGap, setExpandedGap] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Load gap queue + provenance
      const gapRes = await fetch(`/api/deals/${dealId}/gap-queue`);
      const gapData = await gapRes.json();
      if (gapData.ok) {
        setGaps(gapData.gaps ?? []);
        setProvenance(gapData.provenance ?? {});
        setSnapshot({
          exists: gapData.financialSnapshotExists ?? false,
          status: null,
          completenessPercent: gapData.completenessScore ?? null,
          openReviewItems: (gapData.gaps ?? []).length,
          unresolvedConflicts: (gapData.gaps ?? []).filter((g: Gap) => g.gap_type === "conflict").length,
          unresolvedMissingFacts: (gapData.gaps ?? []).filter((g: Gap) => g.gap_type === "missing_fact").length,
          lastBuiltAt: null,
        });
      }

      // Load lifecycle impact
      const lcRes = await fetch(`/api/deals/${dealId}/lifecycle`);
      const lcData = await lcRes.json();
      if (lcData.ok) {
        const derived = lcData.state?.derived ?? {};
        setLifecycle({
          stage: lcData.state?.stage ?? null,
          blocked: derived.financialSnapshotGateReady === false,
          blockerCode: derived.financialSnapshotGateCode ?? null,
          message: derived.financialSnapshotGateCode
            ? `Financial validation blocking: ${derived.financialSnapshotGateCode}`
            : null,
        });
      }
    } catch { /* degrade */ }
    finally { setLoading(false); }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await fetch(`/api/deals/${dealId}/financial-validation/rebuild`, { method: "POST" });
      await load();
    } catch { /* degrade */ }
    finally { setRebuilding(false); }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-4 animate-pulse">
        <div className="h-8 bg-white/10 rounded w-1/3" />
        <div className="h-32 bg-white/5 rounded-xl" />
        <div className="h-48 bg-white/5 rounded-xl" />
      </div>
    );
  }

  const conflicts = gaps.filter((g) => g.gap_type === "conflict");
  const missing = gaps.filter((g) => g.gap_type === "missing_fact");
  const lowConf = gaps.filter((g) => g.gap_type === "low_confidence");

  const badge = STATUS_BADGES[snapshot?.exists ? "needs_review" : "not_started"] ?? STATUS_BADGES.not_started;
  const overallBadge = gaps.length === 0 && snapshot?.exists
    ? STATUS_BADGES.validated
    : gaps.length > 0
    ? STATUS_BADGES.needs_review
    : STATUS_BADGES.not_started;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Financial Validation</h1>
          <span className={`inline-flex items-center mt-1 rounded-full border px-3 py-0.5 text-xs font-semibold ${overallBadge.color}`}>
            {overallBadge.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            {rebuilding ? "Rebuilding..." : "Rebuild Snapshot"}
          </button>
          <a href={`/deals/${dealId}/cockpit`} className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/60 hover:bg-white/10">
            Back to Cockpit
          </a>
        </div>
      </div>

      {/* Snapshot Status Card */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wide">Snapshot Status</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-xs text-white/40">Snapshot</div>
            <div className="text-sm font-semibold">{snapshot?.exists ? "Active" : "Missing"}</div>
          </div>
          <div>
            <div className="text-xs text-white/40">Completeness</div>
            <div className="text-sm font-semibold">{snapshot?.completenessPercent ?? 0}%</div>
          </div>
          <div>
            <div className="text-xs text-white/40">Open Items</div>
            <div className="text-sm font-semibold">{gaps.length}</div>
          </div>
          <div>
            <div className="text-xs text-white/40">Conflicts</div>
            <div className="text-sm font-semibold">{conflicts.length}</div>
          </div>
        </div>
      </div>

      {/* Lifecycle Impact */}
      {lifecycle?.blocked && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
          <div className="text-xs font-semibold text-amber-300 uppercase tracking-wide mb-1">Committee Blocked</div>
          <p className="text-sm text-amber-200">{lifecycle.message}</p>
          <p className="text-xs text-amber-400/70 mt-1">Current stage: {lifecycle.stage}</p>
        </div>
      )}

      {/* Empty state */}
      {!snapshot?.exists && gaps.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-sm text-white/50">No financial snapshot yet.</p>
          <p className="text-xs text-white/35 mt-1">
            Upload financial statements, complete spreads, and generate the snapshot first.
          </p>
          <a href={`/deals/${dealId}/cockpit`} className="inline-block mt-3 text-xs font-semibold bg-white/10 text-white/70 px-3 py-1.5 rounded-md hover:bg-white/15">
            Go to Financials
          </a>
        </div>
      )}

      {/* Review Queue */}
      {gaps.length > 0 && (
        <div className="space-y-4">
          {conflicts.length > 0 && (
            <GapSection title="Conflicts" count={conflicts.length} color="red" gaps={conflicts}
              provenance={provenance} dealId={dealId} expandedGap={expandedGap}
              setExpandedGap={setExpandedGap} onResolved={load} />
          )}
          {missing.length > 0 && (
            <GapSection title="Missing Facts" count={missing.length} color="amber" gaps={missing}
              provenance={provenance} dealId={dealId} expandedGap={expandedGap}
              setExpandedGap={setExpandedGap} onResolved={load} />
          )}
          {lowConf.length > 0 && (
            <GapSection title="Low Confidence" count={lowConf.length} color="blue" gaps={lowConf}
              provenance={provenance} dealId={dealId} expandedGap={expandedGap}
              setExpandedGap={setExpandedGap} onResolved={load} />
          )}
        </div>
      )}

      {/* All Clear */}
      {gaps.length === 0 && snapshot?.exists && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-center">
          <div className="text-sm text-emerald-300 font-semibold">All financial validation items resolved</div>
          <p className="text-xs text-emerald-400/70 mt-1">Snapshot is ready for memo and committee use.</p>
        </div>
      )}
    </div>
  );
}

function GapSection({ title, count, color, gaps, provenance, dealId, expandedGap, setExpandedGap, onResolved }: {
  title: string; count: number; color: string; gaps: Gap[];
  provenance: Record<string, Provenance>; dealId: string;
  expandedGap: string | null; setExpandedGap: (id: string | null) => void;
  onResolved: () => void;
}) {
  const borderColor = color === "red" ? "border-red-500/30" : color === "amber" ? "border-amber-500/30" : "border-blue-500/30";
  const headerColor = color === "red" ? "text-red-300" : color === "amber" ? "text-amber-300" : "text-blue-300";

  return (
    <div className={`rounded-xl border ${borderColor} bg-white/[0.03] overflow-hidden`}>
      <div className="px-4 py-3 border-b border-white/10">
        <span className={`text-xs font-semibold uppercase tracking-wide ${headerColor}`}>
          {title} ({count})
        </span>
      </div>
      <div className="divide-y divide-white/5">
        {gaps.map((gap) => {
          const prov = gap.fact_id ? provenance[gap.fact_id] : null;
          const isExpanded = expandedGap === gap.id;

          return (
            <div key={gap.id} className="px-4 py-3">
              <button
                type="button"
                onClick={() => setExpandedGap(isExpanded ? null : gap.id)}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white/90">{gap.fact_key}</div>
                    <div className="text-xs text-white/50 mt-0.5">{gap.description}</div>
                  </div>
                  <span className="material-symbols-outlined text-white/30 text-[16px]">
                    {isExpanded ? "expand_less" : "expand_more"}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="mt-3 space-y-3">
                  {prov && (
                    <FinancialFactProvenanceViewer
                      provenance={[{
                        documentId: null,
                        extractedField: prov.sourceLineLabel,
                        spreadLineRef: null,
                        manualAdjustmentSource: null,
                        confidence: prov.confidence,
                      }]}
                      primaryDocumentId={null}
                      validationState="unreviewed"
                      reviewerRationale={null}
                    />
                  )}
                  <FinancialFactDecisionForm
                    dealId={dealId}
                    factId={gap.fact_id ?? gap.id}
                    snapshotId=""
                    metricLabel={gap.fact_key}
                    currentValue={prov?.value ?? null}
                    validationState="unreviewed"
                    hasConflict={gap.gap_type === "conflict"}
                    onComplete={onResolved}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
