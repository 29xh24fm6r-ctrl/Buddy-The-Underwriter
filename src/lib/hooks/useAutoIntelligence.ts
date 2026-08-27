"use client";

/**
 * Phase 59 — Auto-Intelligence Polling Hook
 *
 * Fetches once on mount, polls only while a run is queued/running, and
 * suspends all background work while the page is hidden.
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

const POLL_INTERVAL_MS = 10_000;
const RETRY_AFTER_INFLIGHT_MS = 100;
const MAX_CONSECUTIVE_FAILURES = 3;

type PollOutcome = "active" | "idle" | "failed" | "aborted";

function isActiveRunStatus(status: string | null): boolean {
  return status === "queued" || status === "running";
}

export function useAutoIntelligence(dealId: string): AutoIntelligenceUI {
  const [steps, setSteps] = useState<IntelligenceStepUI[]>([]);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const inflightRef = useRef(false);
  const failureCountRef = useRef(0);
  const restartPollingRef = useRef<(() => void) | null>(null);

  const fetchState = useCallback(async (signal?: AbortSignal): Promise<PollOutcome> => {
    try {
      const res = await fetch(`/api/deals/${dealId}/intelligence/auto`, { signal });
      if (!res.ok) {
        failureCountRef.current += 1;
        return "failed";
      }

      const data = await res.json();
      if (!data.ok) {
        failureCountRef.current += 1;
        return "failed";
      }

      failureCountRef.current = 0;
      const nextStatus =
        typeof data.state?.runStatus === "string" ? data.state.runStatus : null;
      setHasRun(data.state?.hasRun ?? false);
      setRunStatus(nextStatus);
      setSteps(data.state?.steps ?? []);
      setLastUpdated(new Date().toISOString());
      return isActiveRunStatus(nextStatus) ? "active" : "idle";
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        return "aborted";
      }
      failureCountRef.current += 1;
      return "failed";
    }
  }, [dealId]);

  useEffect(() => {
    let cancelled = false;

    const clearScheduledPoll = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const schedule = (ms: number) => {
      clearScheduledPoll();
      if (
        cancelled ||
        document.visibilityState !== "visible" ||
        failureCountRef.current >= MAX_CONSECUTIVE_FAILURES
      ) {
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void pollOnce();
      }, ms);
    };

    const pollOnce = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (inflightRef.current) {
        schedule(RETRY_AFTER_INFLIGHT_MS);
        return;
      }

      inflightRef.current = true;
      const controller = new AbortController();
      controllerRef.current = controller;
      const outcome = await fetchState(controller.signal);
      if (controllerRef.current === controller) controllerRef.current = null;
      inflightRef.current = false;

      if (cancelled || document.visibilityState !== "visible") return;
      if (outcome === "active") {
        schedule(POLL_INTERVAL_MS);
      } else if (
        outcome === "failed" &&
        failureCountRef.current < MAX_CONSECUTIVE_FAILURES
      ) {
        schedule(POLL_INTERVAL_MS);
      }
    };

    const restartPolling = () => {
      failureCountRef.current = 0;
      clearScheduledPoll();
      controllerRef.current?.abort();
      if (document.visibilityState === "visible") void pollOnce();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearScheduledPoll();
        controllerRef.current?.abort();
        return;
      }
      restartPolling();
    };

    restartPollingRef.current = restartPolling;
    document.addEventListener("visibilitychange", onVisibilityChange);
    restartPolling();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearScheduledPoll();
      controllerRef.current?.abort();
      controllerRef.current = null;
      inflightRef.current = false;
      if (restartPollingRef.current === restartPolling) {
        restartPollingRef.current = null;
      }
    };
  }, [fetchState]);

  const isRunning = isActiveRunStatus(runStatus);
  const isReady = runStatus === "succeeded";
  const isFailed = runStatus === "failed";
  const isPartial = runStatus === "partial";

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/intelligence/auto/retry`, {
        method: "POST",
      });
      if (!res.ok) return;
      setRunStatus("running");
      restartPollingRef.current?.();
    } catch {
      // The existing state remains visible and the user can retry again.
    } finally {
      setRetrying(false);
    }
  }, [dealId]);

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
