"use client";

import { useEffect, useRef, useState } from "react";

type StageLog = {
  stage: string;
  status: "started" | "succeeded" | "failed" | "skipped";
  message: string;
  timestamp: string;
};

type PipelineStatus = {
  run_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  current_stage: string;
  progress: number;
  stage_logs: StageLog[];
  started_at: string | null;
  finished_at: string | null;
  error: { message: string } | null;
} | null;

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const POLL_INTERVAL_MS = 4000;

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";

/**
 * "Make E-Tran Ready" trigger + live status — SPEC/ARC-00 post-arc fix.
 *
 * Replaces the old fake `/autopilot/run` stub (4 hardcoded ai_events rows
 * claiming etran_ready:true) with a real trigger for the S1-S9 pipeline in
 * src/lib/autopilot/orchestrator.ts, and polls the real
 * GET /autopilot/status endpoint for live stage-by-stage progress instead
 * of an optimistic "done" assumption.
 */
export function AutopilotPanel({ dealId }: { dealId: string }) {
  const [status, setStatus] = useState<PipelineStatus>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchStatus() {
    try {
      const res = await fetch(`/api/deals/${dealId}/autopilot/status`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        setStatus(json.data?.pipeline ?? null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => {
    const isActive = status && !TERMINAL_STATUSES.has(status.status);
    if (isActive && !pollRef.current) {
      pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
    }
    if (!isActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.status]);

  async function handleRun() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/autopilot/run`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setStartError(json?.error || "Failed to start pipeline");
        return;
      }
      await fetchStatus();
    } finally {
      setStarting(false);
    }
  }

  const isRunning = status ? !TERMINAL_STATUSES.has(status.status) : false;

  return (
    <div className={`${glassPanel} p-5 space-y-3`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">Make E-Tran Ready</div>
          <div className="text-xs text-white/50">Runs the agent swarm, arbitration, and package assembly for this deal.</div>
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={starting || isRunning}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {isRunning ? "Running…" : starting ? "Starting…" : "🚀 Make E-Tran Ready"}
        </button>
      </div>

      {startError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {startError}
        </div>
      )}

      {!loading && status && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-white/60">
            <span className="capitalize">{status.status} — {status.current_stage?.replace(/_/g, " ").toLowerCase()}</span>
            <span>{status.progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all ${status.status === "failed" ? "bg-rose-400" : "bg-primary"}`}
              style={{ width: `${status.progress}%` }}
            />
          </div>

          {status.error?.message && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {status.error.message}
            </div>
          )}

          {status.stage_logs?.length > 0 && (
            <ul className="space-y-1 pt-1">
              {status.stage_logs.map((log, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] text-white/50">
                  <span
                    className={
                      log.status === "succeeded"
                        ? "text-emerald-400"
                        : log.status === "failed"
                        ? "text-rose-400"
                        : log.status === "skipped"
                        ? "text-amber-400"
                        : "text-white/40"
                    }
                  >
                    {log.status === "succeeded" ? "✓" : log.status === "failed" ? "✗" : log.status === "skipped" ? "–" : "…"}
                  </span>
                  <span>
                    <span className="font-medium text-white/70">{log.stage.replace(/^S\d_/, "").replace(/_/g, " ").toLowerCase()}:</span>{" "}
                    {log.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
