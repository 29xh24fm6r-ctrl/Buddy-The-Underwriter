"use client";

/**
 * Phase 59 — Auto-Intelligence Polling Hook
 *
 * Polls pipeline state every 2s while running, stops when complete.
 * Provides cockpit-ready step states with human labels.
 */

import { useState, useEffect, useCallback, useRef } from "react";

export type IntelligenceStepUI = {
  code: string;
  label: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  errorDetail: string | null;
};

export type AutoIntelligenceUI = {
  hasRun: boolean;
  isRunning: boolean;
  isReady: boolean;
  isFailed: boolean;
  isPartial: boolean;
  steps: IntelligenceStepUI[];
  failedCount: number;
  succeededCount: number;
  lastUpdatedAt: string | null;
  retrying: boolean;
  retry: () => Promise<void>;
};

const POLL_INTERVAL_MS = 2000;

export function useAutoIntelligence(dealId: string): AutoIntelligenceUI {
  const [steps, setSteps] = useState<IntelligenceStepUI[]>([]);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/intelligence/auto`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok) return;

      setHasRun(data.state?.hasRun ?? false);
      setRunStatus(data.state?.runStatus ?? null);
      setSteps(data.state?.steps ?? []);
      setLastUpdated(new Date().toISOString());
    } catch { /* degrade silently */ }
  }, [dealId]);

  // Initial fetch + polling
  useEffect(() => {
    fetchState();

    intervalRef.current = setInterval(() => {
      fetchState();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchState]);

  // Stop polling when no longer running
  useEffect(() => {
    if (runStatus && runStatus !== "queued" && runStatus !== "running") {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [runStatus]);

  const isRunning = runStatus === "queued" || runStatus === "running";
  const isReady = runStatus === "succeeded";
  const isFailed = runStatus === "failed";
  const isPartial = runStatus === "partial";

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await fetch(`/api/deals/${dealId}/intelligence/auto/retry`, { method: "POST" });
      setRunStatus("running");
      // Restart polling
      if (!intervalRef.current) {
        intervalRef.current = setInterval(fetchState, POLL_INTERVAL_MS);
      }
      await fetchState();
    } catch { /* degrade */ }
    finally { setRetrying(false); }
  }, [dealId, fetchState]);

  return {
    hasRun,
    isRunning,
    isReady,
    isFailed,
    isPartial,
    steps,
    failedCount: steps.filter((s) => s.status === "failed").length,
    succeededCount: steps.filter((s) => s.status === "succeeded").length,
    lastUpdatedAt: lastUpdated,
    retrying,
    retry,
  };
}
