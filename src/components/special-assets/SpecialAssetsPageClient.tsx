"use client";

/**
 * Phase 65K — Special Assets Page Client
 */

import { useCallback, useEffect, useState } from "react";
import type { DealRiskOverlay } from "@/core/special-assets/types";

type Props = { dealId: string };

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  performing: { label: "Performing", color: "text-emerald-400" },
  monitored: { label: "Monitored", color: "text-blue-400" },
  watchlist: { label: "Watchlist", color: "text-amber-400" },
  workout: { label: "Workout", color: "text-red-400" },
  resolution_pending: { label: "Resolution Pending", color: "text-purple-400" },
  resolved: { label: "Resolved", color: "text-white/50" },
};

const SEVERITY_STYLES: Record<string, string> = {
  low: "bg-yellow-500/15 text-yellow-400",
  moderate: "bg-amber-500/20 text-amber-400",
  high: "bg-red-500/20 text-red-400",
  critical: "bg-red-600/30 text-red-300",
};

export default function SpecialAssetsPageClient({ dealId }: Props) {
  const [overlay, setOverlay] = useState<DealRiskOverlay | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchOverlay = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/special-assets/overlay`);
      const json = await res.json();
      if (json.ok) setOverlay(json.overlay);
    } catch (err) { console.error("[SpecialAssets] fetch failed:", err); }
    finally { setLoading(false); }
  }, [dealId]);

  useEffect(() => { fetchOverlay(); }, [fetchOverlay]);

  async function handleOpenWatchlist() {
    setActionLoading(true);
    try {
      await fetch(`/api/deals/${dealId}/special-assets/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ severity: "moderate", primaryReason: "other" }),
      });
      await fetchOverlay();
    } finally { setActionLoading(false); }
  }

  async function handleEscalate() {
    if (!overlay?.activeWatchlistCaseId) return;
    setActionLoading(true);
    try {
      await fetch(`/api/deals/${dealId}/special-assets/watchlist/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchlistCaseId: overlay.activeWatchlistCaseId, severity: "high", strategy: "short_term_cure" }),
      });
      await fetchOverlay();
    } finally { setActionLoading(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><p className="text-white/40 text-sm">Loading...</p></div>;

  const state = STATE_LABELS[overlay?.operatingState ?? "performing"] ?? STATE_LABELS.performing;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white/90">Special Assets</h2>
        <span className={`px-3 py-1 text-xs font-bold uppercase rounded-full border border-white/10 ${state.color}`}>
          {state.label}
        </span>
      </div>

      {/* Overlay summary */}
      <div className="glass-card rounded-xl p-5 space-y-3">
        <div className="grid grid-cols-4 gap-4">
          <div>
            <p className="text-[10px] text-white/40 uppercase">Operating State</p>
            <p className={`text-sm font-medium ${state.color}`}>{state.label}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase">Severity</p>
            <p className="text-sm text-white/70">
              {overlay?.severity ? (
                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${SEVERITY_STYLES[overlay.severity] ?? ""}`}>
                  {overlay.severity}
                </span>
              ) : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase">Open Actions</p>
            <p className="text-sm text-white/70">{overlay?.openActionItemCount ?? 0}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase">Recommendation</p>
            <p className="text-sm text-white/60 capitalize">{overlay?.recommendation?.replace(/_/g, " ") ?? "None"}</p>
          </div>
        </div>

        {overlay?.primaryReasons && overlay.primaryReasons.length > 0 && (
          <div>
            <p className="text-[10px] text-white/40 uppercase mb-1">Reasons</p>
            <div className="flex flex-wrap gap-1">
              {overlay.primaryReasons.map((r) => (
                <span key={r} className="px-2 py-0.5 text-[10px] rounded bg-white/5 border border-white/10 text-white/50">
                  {r.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {overlay?.operatingState === "performing" || overlay?.operatingState === "monitored" ? (
          <button onClick={handleOpenWatchlist} disabled={actionLoading}
            className="px-4 py-2 text-sm rounded-lg bg-amber-600/80 text-white hover:bg-amber-500 transition disabled:opacity-50">
            Open Watchlist Case
          </button>
        ) : null}
        {overlay?.operatingState === "watchlist" && (
          <>
            <button onClick={handleEscalate} disabled={actionLoading}
              className="px-4 py-2 text-sm rounded-lg bg-red-600/80 text-white hover:bg-red-500 transition disabled:opacity-50">
              Escalate to Workout
            </button>
          </>
        )}
      </div>

      {overlay?.operatingState === "performing" && (
        <div className="text-center text-white/30 py-8 text-sm">
          This deal is performing. No watchlist or workout cases active.
        </div>
      )}
    </div>
  );
}
