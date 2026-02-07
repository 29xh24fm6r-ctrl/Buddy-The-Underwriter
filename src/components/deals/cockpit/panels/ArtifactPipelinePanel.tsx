"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

type PendingMatch = {
  id: string;
  artifact_id: string | null;
  checklist_key: string | null;
  confidence: number | null;
  reason: string | null;
  tax_year: number | null;
  status: string;
};

type FailedArtifact = {
  id: string;
  doc_type: string | null;
  error_message: string | null;
};

type Props = {
  dealId: string;
};

export function ArtifactPipelinePanel({ dealId }: Props) {
  const { artifactSummary, isBusy } = useCockpitDataContext();
  const [pendingMatches, setPendingMatches] = useState<PendingMatch[]>([]);
  const [failedArtifacts, setFailedArtifacts] = useState<FailedArtifact[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch pending matches and failed artifacts when expanded
  const fetchMatches = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/artifacts`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        if (json.pending_matches) {
          setPendingMatches(json.pending_matches.filter((m: PendingMatch) => m.status === "proposed"));
        }
        if (json.artifacts) {
          setFailedArtifacts(
            (json.artifacts as Array<{ id: string; status: string | null; doc_type: string | null; error_message: string | null }>)
              .filter((a) => a.status === "failed")
              .map((a) => ({ id: a.id, doc_type: a.doc_type, error_message: a.error_message })),
          );
        }
      }
    } catch {
      // Non-fatal
    }
  }, [dealId]);

  useEffect(() => {
    if (expanded) fetchMatches();
  }, [expanded, fetchMatches]);

  // Also refetch when artifact summary changes
  useEffect(() => {
    if (expanded && artifactSummary) fetchMatches();
  }, [expanded, artifactSummary?.matched, fetchMatches]);

  const handleMatchAction = useCallback(
    async (matchId: string, action: "confirm" | "reject") => {
      setActionLoading(matchId);
      try {
        await fetch(`/api/deals/${dealId}/artifacts/matches/${matchId}/${action}`, {
          method: "POST",
        });
        setPendingMatches((prev) => prev.filter((m) => m.id !== matchId));
      } catch {
        // Non-fatal
      } finally {
        setActionLoading(null);
      }
    },
    [dealId],
  );

  const handleRequeue = useCallback(
    async (artifactId: string) => {
      setActionLoading(artifactId);
      try {
        await fetch(`/api/deals/${dealId}/artifacts/${artifactId}/requeue`, {
          method: "POST",
        });
        setFailedArtifacts((prev) => prev.filter((a) => a.id !== artifactId));
      } catch {
        // Non-fatal
      } finally {
        setActionLoading(null);
      }
    },
    [dealId],
  );

  const summary = artifactSummary;
  if (!summary || summary.total_files === 0) return null;

  const isProcessingActive = (summary.processing ?? 0) > 0 || (summary.queued ?? 0) > 0;
  const processingPct =
    summary.total_files > 0
      ? Math.round(((summary.classified + summary.matched) / summary.total_files) * 100)
      : 0;

  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      <div className={glassHeader}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "material-symbols-outlined text-[18px]",
                isProcessingActive ? "text-amber-400 animate-pulse" : "text-violet-400",
              )}
            >
              {isProcessingActive ? "progress_activity" : "auto_awesome"}
            </span>
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">
              Document Pipeline
            </span>
          </div>
          {pendingMatches.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
              {pendingMatches.length} review
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Compact stats */}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-white/50">{summary.total_files} docs</span>
          {summary.queued > 0 && (
            <span className="text-amber-300">{summary.queued} queued</span>
          )}
          {summary.processing > 0 && (
            <span className="text-sky-300">{summary.processing} processing</span>
          )}
          <span className="text-emerald-300">{summary.matched} matched</span>
          {summary.failed > 0 && (
            <span className="text-red-300">{summary.failed} failed</span>
          )}
        </div>

        {/* Progress bar */}
        {isProcessingActive && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-white/40">
              <span>Classification progress</span>
              <span>{processingPct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-500"
                style={{ width: `${processingPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Pending matches that need review */}
        {pendingMatches.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-white/50 font-semibold">Pending Matches</div>
            {pendingMatches.slice(0, 5).map((match) => (
              <div
                key={match.id}
                className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/5"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white/80 truncate">
                    {match.checklist_key?.replace(/_/g, " ") || "Unknown"}
                  </div>
                  <div className="text-[10px] text-white/40">
                    {match.confidence !== null && `${Math.round(match.confidence * 100)}% confidence`}
                    {match.tax_year && ` | ${match.tax_year}`}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleMatchAction(match.id, "confirm")}
                    disabled={actionLoading === match.id}
                    className="px-2 py-1 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleMatchAction(match.id, "reject")}
                    disabled={actionLoading === match.id}
                    className="px-2 py-1 rounded text-[10px] font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Failed documents with per-document retry */}
        {expanded && failedArtifacts.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-white/50 font-semibold">Failed Documents</div>
            {failedArtifacts.slice(0, 5).map((artifact) => (
              <div
                key={artifact.id}
                className="flex items-center gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/10"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white/70 truncate">
                    {artifact.doc_type?.replace(/_/g, " ") || "Unclassified"}
                  </div>
                  <div className="text-[10px] text-red-300/70 truncate">
                    {artifact.error_message || "Processing failed"}
                  </div>
                </div>
                <button
                  onClick={() => handleRequeue(artifact.id)}
                  disabled={actionLoading === artifact.id}
                  className="px-2 py-1 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
                >
                  {actionLoading === artifact.id ? "Retrying..." : "Retry"}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Expand for full artifact detail */}
        {summary.total_files > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full text-[10px] text-white/40 hover:text-white/60 transition-colors text-center"
          >
            {expanded ? "Show less" : "Show details"}
          </button>
        )}
      </div>
    </div>
  );
}
