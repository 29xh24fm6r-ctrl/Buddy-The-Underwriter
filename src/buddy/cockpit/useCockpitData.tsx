"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePipelineState } from "@/lib/pipeline/usePipelineState";

/**
 * Cockpit Data Hook
 *
 * Centralized data fetching for the deal cockpit with smart polling:
 * - Polls fast (3-5s) when deal is busy (uploads, AI classification, etc.)
 * - Polls slow (30s) or not at all when idle
 * - Stops polling when tab is hidden
 * - Provides unified isBusy state for all widgets
 *
 * Goals:
 * - No network churn unless (a) user acts, or (b) deal is actively processing
 * - Single source of truth for "should we poll?"
 */

// Polling intervals
const BUSY_POLL_MS = 5000; // 5s when busy
const IDLE_POLL_MS = 30000; // 30s when idle (optional, can be 0 for no idle polling)
const NO_POLL = 0;

export type ChecklistSummary = {
  state: "empty" | "processing" | "ready";
  total: number;
  received: number;
  pending: number;
  optional: number;
};

export type CockpitData = {
  /** Whether the deal is currently processing (uploads, AI, etc.) */
  isBusy: boolean;
  /** Whether polling is currently active */
  isPolling: boolean;
  /** Checklist summary stats */
  checklistSummary: ChecklistSummary | null;
  /** Number of uploads currently processing */
  processingUploads: number;
  /** Last fetch timestamp */
  lastFetchedAt: string | null;
  /** Any error from the last fetch */
  error: string | null;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
  /** Whether tab is visible */
  isVisible: boolean;
};

async function fetchChecklistSummary(dealId: string): Promise<ChecklistSummary | null> {
  try {
    const res = await fetch(`/api/deals/${dealId}/checklist`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.ok) return null;
    return {
      state: json.state || "ready",
      total: json.total || 0,
      received: json.received || 0,
      pending: json.pending?.length || 0,
      optional: json.optional || 0,
    };
  } catch {
    return null;
  }
}

async function fetchUploadsStatus(dealId: string): Promise<number> {
  try {
    const res = await fetch(`/api/deals/${dealId}/uploads/status`, { cache: "no-store" });
    if (!res.ok) return 0;
    const json = await res.json();
    return json.processing || 0;
  } catch {
    return 0;
  }
}

export function useCockpitData(dealId: string | null): CockpitData {
  // Use existing pipeline state hook for working/idle detection
  const { pipeline } = usePipelineState(dealId);

  const [checklistSummary, setChecklistSummary] = useState<ChecklistSummary | null>(null);
  const [processingUploads, setProcessingUploads] = useState(0);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);

  // Derive isBusy from pipeline state and processing uploads
  const isBusy = pipeline.isWorking || processingUploads > 0 || checklistSummary?.state === "processing";

  // Determine polling interval based on busy state and visibility
  const pollInterval = !isVisible ? NO_POLL : isBusy ? BUSY_POLL_MS : IDLE_POLL_MS;
  const isPolling = pollInterval > 0 && isVisible;

  const fetchData = useCallback(async () => {
    if (!dealId) return;
    if (inflightRef.current) return;

    inflightRef.current = true;
    try {
      const [checklist, uploads] = await Promise.all([
        fetchChecklistSummary(dealId),
        fetchUploadsStatus(dealId),
      ]);

      setChecklistSummary(checklist);
      setProcessingUploads(uploads);
      setLastFetchedAt(new Date().toISOString());
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to fetch cockpit data");
    } finally {
      inflightRef.current = false;
    }
  }, [dealId]);

  // Handle visibility changes
  useEffect(() => {
    const handleVisibility = () => {
      const visible = document.visibilityState === "visible";
      setIsVisible(visible);
      // Fetch immediately when becoming visible
      if (visible && dealId) {
        void fetchData();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [dealId, fetchData]);

  // Polling loop
  useEffect(() => {
    if (!dealId) return;

    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Initial fetch
    void fetchData();

    // Schedule next poll if polling is enabled
    const schedulePoll = () => {
      if (pollInterval <= 0) return;
      if (!isVisible) return;

      timerRef.current = setTimeout(() => {
        void fetchData().then(() => {
          schedulePoll();
        });
      }, pollInterval);
    };

    schedulePoll();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [dealId, pollInterval, isVisible, fetchData]);

  const refresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  return {
    isBusy,
    isPolling,
    checklistSummary,
    processingUploads,
    lastFetchedAt,
    error,
    refresh,
    isVisible,
  };
}

/**
 * Context for cockpit data - allows widgets to subscribe without re-fetching.
 */
import { createContext, useContext, type ReactNode } from "react";

const CockpitDataContext = createContext<CockpitData | null>(null);

export function CockpitDataProvider({
  dealId,
  children,
}: {
  dealId: string;
  children: ReactNode;
}) {
  const data = useCockpitData(dealId);
  return (
    <CockpitDataContext.Provider value={data}>
      {children}
    </CockpitDataContext.Provider>
  );
}

export function useCockpitDataContext(): CockpitData {
  const ctx = useContext(CockpitDataContext);
  if (!ctx) {
    throw new Error("useCockpitDataContext must be used within CockpitDataProvider");
  }
  return ctx;
}

/**
 * Hook for widgets that just need to know if they should poll.
 * Returns { shouldPoll, isBusy } for simple conditional polling.
 */
export function useShouldPoll(): { shouldPoll: boolean; isBusy: boolean } {
  const ctx = useContext(CockpitDataContext);
  // If not in context, return conservative defaults (no polling)
  if (!ctx) {
    return { shouldPoll: false, isBusy: false };
  }
  return {
    shouldPoll: ctx.isPolling,
    isBusy: ctx.isBusy,
  };
}
