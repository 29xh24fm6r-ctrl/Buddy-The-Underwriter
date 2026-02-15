"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

const glassPanel =
  "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

// ── Types ──

type JobBucket = {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
};

type PipelineStatus = {
  ok: boolean;
  dealId: string;
  docs: {
    total: number;
    classified: number;
    needsReview: number;
    lastUploadedAt: string | null;
  };
  jobs: {
    ocr: JobBucket;
    classify: JobBucket;
    extract: JobBucket;
    spreads: JobBucket;
  };
  facts: {
    total: number;
    lastCreatedAt: string | null;
  };
  spreads: {
    types: string[];
    ready: number;
    generating: number;
    error: number;
    lastUpdatedAt: string | null;
  };
  ledger: Array<{
    stage: string;
    event_key: string | null;
    status: string;
    payload: any;
    ui_state: string | null;
    ui_message: string | null;
    created_at: string;
  }>;
};

type LaneStatus = "green" | "yellow" | "red" | "grey";

// ── Helpers ──

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function laneIcon(status: LaneStatus): string {
  if (status === "green") return "check_circle";
  if (status === "yellow") return "progress_activity";
  if (status === "red") return "error";
  return "radio_button_unchecked";
}

function laneColor(status: LaneStatus): string {
  if (status === "green") return "text-emerald-400";
  if (status === "yellow") return "text-amber-400";
  if (status === "red") return "text-red-400";
  return "text-white/30";
}

function laneLabel(status: LaneStatus): string {
  if (status === "green") return "Ready";
  if (status === "yellow") return "Processing";
  if (status === "red") return "Error";
  return "Waiting";
}

function isActive(bucket: JobBucket): boolean {
  return bucket.queued > 0 || bucket.running > 0;
}

// ── Component ──

type Props = {
  dealId: string;
  isAdmin?: boolean;
};

export function PipelinePanel({ dealId, isAdmin = false }: Props) {
  const [data, setData] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ledgerExpanded, setLedgerExpanded] = useState(false);
  const [recomputeScope, setRecomputeScope] = useState("ALL");
  const [recomputeBusy, setRecomputeBusy] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/pipeline-status`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.ok) {
        setData(json as PipelineStatus);
        setError(null);
      } else {
        setError(json.error ?? "fetch_failed");
      }
    } catch {
      setError("network_error");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  // Poll every 10s
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // ── Derive lane statuses ──
  let docsLane: LaneStatus = "grey";
  let factsLane: LaneStatus = "grey";
  let spreadsLane: LaneStatus = "grey";

  if (data) {
    // Docs lane
    if (data.docs.total === 0) {
      docsLane = "grey";
    } else if (
      isActive(data.jobs.ocr) ||
      isActive(data.jobs.classify)
    ) {
      docsLane = "yellow";
    } else if (data.docs.classified > 0 && data.docs.needsReview === 0) {
      docsLane = "green";
    } else if (data.docs.total > 0 && data.docs.classified === 0) {
      docsLane = "red";
    } else if (data.docs.needsReview > 0) {
      docsLane = "yellow";
    } else {
      docsLane = "green";
    }

    // Facts lane
    if (data.facts.total > 0) {
      factsLane = "green";
    } else if (isActive(data.jobs.extract)) {
      factsLane = "yellow";
    } else if (data.jobs.extract.failed > 0) {
      factsLane = "red";
    }

    // Spreads lane
    if (data.spreads.ready > 0 && data.spreads.error === 0) {
      spreadsLane = "green";
    } else if (data.spreads.generating > 0 || isActive(data.jobs.spreads)) {
      spreadsLane = "yellow";
    } else if (data.spreads.error > 0) {
      spreadsLane = "red";
    }
  }

  const handleRecompute = useCallback(async () => {
    setRecomputeBusy(true);
    setRecomputeMsg(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/pipeline-recompute?scope=${recomputeScope}`,
        { method: "POST" },
      );
      const json = await res.json();
      if (json.ok) {
        const counts = json.counts ?? {};
        const parts = Object.entries(counts)
          .filter(([, v]) => (v as number) > 0)
          .map(([k, v]) => `${k}: ${v}`);
        setRecomputeMsg(
          parts.length > 0 ? `Enqueued: ${parts.join(", ")}` : "Nothing to enqueue",
        );
        // Refresh status
        fetchStatus();
      } else {
        setRecomputeMsg(`Error: ${json.error}`);
      }
    } catch {
      setRecomputeMsg("Network error");
    } finally {
      setRecomputeBusy(false);
    }
  }, [dealId, recomputeScope, fetchStatus]);

  if (loading && !data) {
    return (
      <div className={cn(glassPanel, "overflow-hidden p-4")}>
        <div className="text-xs text-white/30 animate-pulse">
          Loading pipeline status...
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={cn(glassPanel, "overflow-hidden p-4")}>
        <div className="text-xs text-red-300/70">
          Pipeline status unavailable
        </div>
      </div>
    );
  }

  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      <div className={glassHeader}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-sky-400">
            monitoring
          </span>
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">
            Pipeline Status
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* 3 Status Lanes */}
        <div className="space-y-2">
          {/* Docs lane */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "material-symbols-outlined text-[16px]",
                laneColor(docsLane),
                docsLane === "yellow" && "animate-pulse",
              )}
            >
              {laneIcon(docsLane)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/80">Docs Recognized</span>
                <span className="text-[10px] text-white/40">
                  {laneLabel(docsLane)}
                </span>
              </div>
              <div className="text-[10px] text-white/40">
                {data
                  ? `${data.docs.classified}/${data.docs.total} classified`
                  : "--"}
                {data && data.docs.needsReview > 0 && (
                  <span className="text-amber-300 ml-1">
                    ({data.docs.needsReview} need review)
                  </span>
                )}
                {data?.docs.lastUploadedAt && (
                  <span className="ml-2">
                    Last: {relativeTime(data.docs.lastUploadedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Facts lane */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "material-symbols-outlined text-[16px]",
                laneColor(factsLane),
                factsLane === "yellow" && "animate-pulse",
              )}
            >
              {laneIcon(factsLane)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/80">Facts Extracted</span>
                <span className="text-[10px] text-white/40">
                  {laneLabel(factsLane)}
                </span>
              </div>
              <div className="text-[10px] text-white/40">
                {data ? `${data.facts.total} facts` : "--"}
                {data?.facts.lastCreatedAt && (
                  <span className="ml-2">
                    Last: {relativeTime(data.facts.lastCreatedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Spreads lane */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "material-symbols-outlined text-[16px]",
                laneColor(spreadsLane),
                spreadsLane === "yellow" && "animate-pulse",
              )}
            >
              {laneIcon(spreadsLane)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/80">
                  Spreads Generated
                </span>
                <span className="text-[10px] text-white/40">
                  {laneLabel(spreadsLane)}
                </span>
              </div>
              <div className="text-[10px] text-white/40">
                {data
                  ? `${data.spreads.ready} ready`
                  : "--"}
                {data && data.spreads.generating > 0 && (
                  <span className="text-amber-300 ml-1">
                    {data.spreads.generating} generating
                  </span>
                )}
                {data && data.spreads.error > 0 && (
                  <span className="text-red-300 ml-1">
                    {data.spreads.error} error
                  </span>
                )}
                {data?.spreads.lastUpdatedAt && (
                  <span className="ml-2">
                    Last: {relativeTime(data.spreads.lastUpdatedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible Recent Events */}
        <div>
          <button
            onClick={() => setLedgerExpanded(!ledgerExpanded)}
            className="w-full flex items-center justify-between text-[10px] text-white/40 hover:text-white/60 transition-colors"
          >
            <span>Recent Events</span>
            <span className="material-symbols-outlined text-[14px]">
              {ledgerExpanded ? "expand_less" : "expand_more"}
            </span>
          </button>

          {ledgerExpanded && data && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {data.ledger.length === 0 && (
                <div className="text-[10px] text-white/30">No events yet</div>
              )}
              {data.ledger.slice(0, 10).map((e, i) => (
                <div
                  key={`${e.created_at}-${i}`}
                  className="flex items-start gap-2 text-[10px]"
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full mt-1 shrink-0",
                      e.status === "ok"
                        ? "bg-emerald-400"
                        : e.status === "error"
                          ? "bg-red-400"
                          : "bg-amber-400",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-white/60">
                      {e.event_key ?? e.stage}
                    </span>
                    {e.ui_message && (
                      <span className="text-white/40 ml-1 truncate">
                        {e.ui_message}
                      </span>
                    )}
                  </div>
                  <span className="text-white/30 shrink-0">
                    {relativeTime(e.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Admin: Recompute section */}
        {isAdmin && (
          <div className="pt-2 border-t border-white/5 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Admin
            </div>
            <div className="flex items-center gap-2">
              <select
                value={recomputeScope}
                onChange={(e) => setRecomputeScope(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/70"
              >
                <option value="ALL">All stages</option>
                <option value="DOCS">Docs only</option>
                <option value="EXTRACT">Extract only</option>
                <option value="SPREADS">Spreads only</option>
              </select>
              <button
                onClick={handleRecompute}
                disabled={recomputeBusy}
                className={cn(
                  "rounded-lg px-3 py-1 text-[10px] font-semibold transition-colors",
                  recomputeBusy
                    ? "bg-white/5 text-white/30"
                    : "bg-sky-500/20 text-sky-300 hover:bg-sky-500/30",
                )}
              >
                {recomputeBusy ? "Running..." : "Recompute Now"}
              </button>
            </div>
            {recomputeMsg && (
              <div
                className={cn(
                  "text-[10px]",
                  recomputeMsg.startsWith("Error")
                    ? "text-red-300/70"
                    : "text-emerald-300/70",
                )}
              >
                {recomputeMsg}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
