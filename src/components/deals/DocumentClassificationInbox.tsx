"use client";

import { useEffect, useState, useCallback } from "react";
import { Icon } from "@/components/ui/Icon";

type Artifact = {
  id: string;
  source_table: string;
  source_id: string;
  status: string;
  doc_type: string | null;
  doc_type_confidence: number | null;
  tax_year: number | null;
  entity_name: string | null;
  matched_checklist_key: string | null;
  match_confidence: number | null;
  proposed_deal_name: string | null;
  error_message: string | null;
  created_at: string;
  classified_at: string | null;
  matched_at: string | null;
};

type PendingMatch = {
  id: string;
  artifact_id: string;
  checklist_key: string;
  confidence: number;
  reason: string | null;
  tax_year: number | null;
  status: string;
  created_at: string;
};

type ArtifactsSummary = {
  total_files: number;
  queued: number;
  processing: number;
  classified: number;
  matched: number;
  failed: number;
  proposed_matches: number;
  auto_applied_matches: number;
  confirmed_matches: number;
};

type ArtifactsResponse = {
  ok: boolean;
  summary: ArtifactsSummary;
  artifacts: Artifact[];
  pending_matches: PendingMatch[];
};

function confBadge(conf: number | null) {
  if (conf === null) return { label: "—", className: "bg-slate-100 text-slate-600" };
  const pct = Math.round(conf * 100);
  if (pct >= 85) return { label: `${pct}%`, className: "bg-emerald-100 text-emerald-700" };
  if (pct >= 70) return { label: `${pct}%`, className: "bg-amber-100 text-amber-700" };
  return { label: `${pct}%`, className: "bg-red-100 text-red-700" };
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    queued: { label: "Queued", className: "bg-slate-100 text-slate-600" },
    processing: { label: "Processing", className: "bg-blue-100 text-blue-700" },
    classified: { label: "Classified", className: "bg-purple-100 text-purple-700" },
    matched: { label: "Matched", className: "bg-emerald-100 text-emerald-700" },
    failed: { label: "Failed", className: "bg-red-100 text-red-700" },
  };
  return map[status] || { label: status, className: "bg-slate-100 text-slate-600" };
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function DocumentClassificationInbox({ dealId }: { dealId: string }) {
  const [data, setData] = useState<ArtifactsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/artifacts`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function triggerBackfill() {
    setBackfilling(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/artifacts/backfill`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  }

  async function triggerProcess() {
    setProcessing(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/artifacts/process`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Processing failed");
    } finally {
      setProcessing(false);
    }
  }

  async function confirmMatch(matchId: string) {
    setActionBusy(matchId);
    try {
      const res = await fetch(`/api/deals/${dealId}/artifacts/matches/${matchId}/confirm`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Confirm failed");
    } finally {
      setActionBusy(null);
    }
  }

  async function rejectMatch(matchId: string) {
    setActionBusy(matchId);
    try {
      const res = await fetch(`/api/deals/${dealId}/artifacts/matches/${matchId}/reject`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Reject failed");
    } finally {
      setActionBusy(null);
    }
  }

  const summary = data?.summary;
  const artifacts = data?.artifacts || [];
  const pendingMatches = data?.pending_matches || [];

  // Group artifacts by status
  const queuedArtifacts = artifacts.filter((a) => a.status === "queued");
  const processingArtifacts = artifacts.filter((a) => a.status === "processing");
  const failedArtifacts = artifacts.filter((a) => a.status === "failed");
  const classifiedArtifacts = artifacts.filter(
    (a) => a.status === "classified" || a.status === "matched"
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
      {/* Header */}
      <div className="border-b border-white/10 bg-white/[0.02] px-5 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon name="auto_awesome" className="h-5 w-5 text-amber-400" />
            <div>
              <div className="text-sm font-semibold text-white">Document Classification</div>
              <div className="text-xs text-white/60">
                AI-powered document analysis and checklist matching
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={loading}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              onClick={triggerBackfill}
              disabled={backfilling}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-50"
            >
              {backfilling ? "Backfilling..." : "Backfill"}
            </button>
            <button
              onClick={triggerProcess}
              disabled={processing || (summary?.queued || 0) === 0}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {processing ? "Processing..." : `Process (${summary?.queued || 0})`}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Summary Stats */}
      {summary && (
        <div className="px-5 py-4 border-b border-white/10">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <div className="text-center">
              <div className="text-lg font-semibold text-white">{summary.total_files}</div>
              <div className="text-[10px] text-white/50">Total Files</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-amber-400">{summary.queued}</div>
              <div className="text-[10px] text-white/50">Queued</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-blue-400">{summary.processing}</div>
              <div className="text-[10px] text-white/50">Processing</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-emerald-400">{summary.matched}</div>
              <div className="text-[10px] text-white/50">Matched</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-red-400">{summary.failed}</div>
              <div className="text-[10px] text-white/50">Failed</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-purple-400">
                {summary.proposed_matches}
              </div>
              <div className="text-[10px] text-white/50">Pending Review</div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-5 space-y-6">
        {loading ? (
          <div className="text-center text-sm text-white/60 py-8">Loading...</div>
        ) : (
          <>
            {/* Pending Matches - Need Review */}
            {pendingMatches.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-3">
                  Needs Review ({pendingMatches.length})
                </div>
                <div className="space-y-2">
                  {pendingMatches.map((match) => {
                    const artifact = artifacts.find((a) => a.id === match.artifact_id);
                    const conf = confBadge(match.confidence);
                    const isBusy = actionBusy === match.id;

                    return (
                      <div
                        key={match.id}
                        className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${conf.className}`}
                              >
                                {conf.label}
                              </span>
                              <span className="text-sm font-medium text-white">
                                → {match.checklist_key}
                              </span>
                              {match.tax_year && (
                                <span className="text-xs text-white/60">({match.tax_year})</span>
                              )}
                            </div>
                            {artifact && (
                              <div className="mt-1 text-xs text-white/60">
                                {artifact.doc_type || "Unknown type"} •{" "}
                                {artifact.entity_name || "Unknown entity"}
                              </div>
                            )}
                            {match.reason && (
                              <div className="mt-1 text-xs text-white/50 line-clamp-2">
                                {match.reason}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => confirmMatch(match.id)}
                              disabled={isBusy}
                              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                            >
                              {isBusy ? "..." : "Confirm"}
                            </button>
                            <button
                              onClick={() => rejectMatch(match.id)}
                              disabled={isBusy}
                              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                            >
                              {isBusy ? "..." : "Reject"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Failed Artifacts */}
            {failedArtifacts.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-red-400 mb-3">
                  Failed ({failedArtifacts.length})
                </div>
                <div className="space-y-2">
                  {failedArtifacts.map((artifact) => (
                    <div
                      key={artifact.id}
                      className="rounded-xl border border-red-500/20 bg-red-500/5 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-white/80">
                          {artifact.source_table}/{artifact.source_id.slice(0, 8)}...
                        </div>
                        <span className="text-xs text-red-400">
                          {artifact.error_message || "Unknown error"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Classified Artifacts */}
            {classifiedArtifacts.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-3">
                  Classified ({classifiedArtifacts.length})
                </div>
                <div className="space-y-2">
                  {classifiedArtifacts.slice(0, 10).map((artifact) => {
                    const status = statusBadge(artifact.status);
                    const conf = confBadge(artifact.doc_type_confidence);

                    return (
                      <div
                        key={artifact.id}
                        className="rounded-xl border border-white/10 bg-white/5 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${status.className}`}
                              >
                                {status.label}
                              </span>
                              <span className="text-sm font-medium text-white">
                                {artifact.doc_type || "Unknown"}
                              </span>
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${conf.className}`}
                              >
                                {conf.label}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-white/60">
                              {artifact.entity_name || "—"} •{" "}
                              {artifact.tax_year || "—"} •{" "}
                              {artifact.matched_checklist_key || "No match"}
                            </div>
                            {artifact.proposed_deal_name && (
                              <div className="mt-1 text-xs text-emerald-400">
                                Suggested deal name: {artifact.proposed_deal_name}
                              </div>
                            )}
                          </div>
                          <div className="text-[10px] text-white/40 text-right shrink-0">
                            {formatDate(artifact.classified_at || artifact.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {classifiedArtifacts.length > 10 && (
                    <div className="text-center text-xs text-white/50 py-2">
                      +{classifiedArtifacts.length - 10} more
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Queued */}
            {queuedArtifacts.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-3">
                  Queued ({queuedArtifacts.length})
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                  {queuedArtifacts.length} document(s) waiting to be processed.
                  Click "Process" to classify them.
                </div>
              </div>
            )}

            {/* Empty state */}
            {artifacts.length === 0 && pendingMatches.length === 0 && (
              <div className="text-center py-8">
                <Icon
                  name="description"
                  className="h-12 w-12 text-white/20 mx-auto mb-3"
                />
                <div className="text-sm text-white/60">No documents to classify</div>
                <div className="text-xs text-white/40 mt-1">
                  Upload documents or click "Backfill" to queue existing ones
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
