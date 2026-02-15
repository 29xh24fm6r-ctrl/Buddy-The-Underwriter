"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePipelineState } from "@/lib/pipeline/usePipelineState";
import type { LifecycleState, LifecycleStage } from "@/buddy/lifecycle/model";
import { STAGE_LABELS } from "@/buddy/lifecycle/model";

/**
 * Cockpit Data Hook
 *
 * Centralized data fetching for the deal cockpit with smart polling:
 * - Polls fast (3-5s) when deal is busy (uploads, AI classification, etc.)
 * - Polls slow (30s) or not at all when idle
 * - Stops polling when tab is hidden
 * - Provides unified isBusy state for all widgets
 * - Tracks state changes and emits "what changed" toasts
 *
 * Goals:
 * - No network churn unless (a) user acts, or (b) deal is actively processing
 * - Single source of truth for "should we poll?"
 * - Make state changes visible to user
 */

// Polling intervals
const BUSY_POLL_MS = 5000; // 5s when busy
const IDLE_POLL_MS = 30000; // 30s when idle (optional, can be 0 for no idle polling)
const NO_POLL = 0;
const USER_ACTION_TIMEOUT_MS = 30000; // Consider "active" for 30s after user action

export type ChecklistSummary = {
  state: "empty" | "processing" | "ready";
  total: number;
  received: number;
  pending: number;
  optional: number;
};

export type ArtifactsSummary = {
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

export type CockpitToast = {
  id: string;
  type: "stage_advanced" | "blockers_cleared" | "doc_classified" | "upload_complete" | "info";
  title: string;
  detail?: string;
  ts: number;
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
  /** Artifact processing summary */
  artifactSummary: ArtifactsSummary | null;
  /** Last fetch timestamp */
  lastFetchedAt: string | null;
  /** Any error from the last fetch (suppressed for first 3 consecutive failures) */
  error: string | null;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
  /** Whether tab is visible */
  isVisible: boolean;
  /** Current lifecycle state (for diff tracking) */
  lifecycleState: LifecycleState | null;
  /** Active toasts (what changed) */
  toasts: CockpitToast[];
  /** Dismiss a toast */
  dismissToast: (id: string) => void;
  /** Mark user action (keeps Live indicator active for 30s) */
  markUserAction: () => void;
  /** Whether user has acted recently (within 30s) */
  userRecentlyActive: boolean;
  /** True until the first successful fetch completes */
  isInitialLoading: boolean;
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

async function fetchArtifactSummary(dealId: string): Promise<ArtifactsSummary | null> {
  try {
    const res = await fetch(`/api/deals/${dealId}/artifacts`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.ok) return null;
    return json.summary ?? null;
  } catch {
    return null;
  }
}

async function fetchLifecycleState(dealId: string): Promise<LifecycleState | null> {
  try {
    const res = await fetch(`/api/deals/${dealId}/lifecycle`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.state || null;
  } catch {
    return null;
  }
}

/**
 * Compute diffs between lifecycle states and return toast descriptions.
 */
function computeLifecycleDiff(
  prev: LifecycleState | null,
  next: LifecycleState | null
): CockpitToast[] {
  if (!prev || !next) return [];

  const toasts: CockpitToast[] = [];
  const now = Date.now();

  // Stage advancement
  if (prev.stage !== next.stage) {
    const label = STAGE_LABELS[next.stage] || next.stage;
    toasts.push({
      id: `stage_${now}`,
      type: "stage_advanced",
      title: `Advanced to ${label}`,
      ts: now,
    });
  }

  // Blockers cleared
  const prevBlockerCount = prev.blockers.length;
  const nextBlockerCount = next.blockers.length;
  if (nextBlockerCount < prevBlockerCount) {
    const cleared = prevBlockerCount - nextBlockerCount;
    toasts.push({
      id: `blockers_${now}`,
      type: "blockers_cleared",
      title: `${cleared} blocker${cleared > 1 ? "s" : ""} cleared`,
      ts: now,
    });
  }

  // Docs progress
  const prevDocsPct = prev.derived.documentsReadinessPct;
  const nextDocsPct = next.derived.documentsReadinessPct;
  if (nextDocsPct > prevDocsPct && nextDocsPct === 100) {
    toasts.push({
      id: `docs_${now}`,
      type: "doc_classified",
      title: "All required documents received",
      ts: now,
    });
  }

  // Financial snapshot appeared
  if (!prev.derived.financialSnapshotExists && next.derived.financialSnapshotExists) {
    toasts.push({
      id: `snapshot_${now}`,
      type: "info",
      title: "Financial snapshot ready",
      ts: now,
    });
  }

  return toasts;
}

export function useCockpitData(dealId: string | null, initialLifecycleState?: LifecycleState | null): CockpitData {
  // Use existing pipeline state hook for working/idle detection
  const { pipeline } = usePipelineState(dealId);

  const [checklistSummary, setChecklistSummary] = useState<ChecklistSummary | null>(null);
  const [processingUploads, setProcessingUploads] = useState(0);
  const [artifactSummary, setArtifactSummary] = useState<ArtifactsSummary | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [lifecycleState, setLifecycleState] = useState<LifecycleState | null>(initialLifecycleState ?? null);
  const [toasts, setToasts] = useState<CockpitToast[]>([]);
  const [lastUserActionAt, setLastUserActionAt] = useState<number | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(!initialLifecycleState);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);
  const prevLifecycleRef = useRef<LifecycleState | null>(initialLifecycleState ?? null);
  const prevArtifactMatchedRef = useRef<number>(0);
  /** Consecutive fetch failures — suppress error UI until 3+ failures */
  const consecutiveErrorsRef = useRef(0);
  const TRANSIENT_ERROR_THRESHOLD = 3;

  // Check if user has acted recently (within 30s)
  const userRecentlyActive = lastUserActionAt !== null && Date.now() - lastUserActionAt < USER_ACTION_TIMEOUT_MS;

  // Derive isBusy from pipeline state, processing uploads, and artifact processing
  const isBusy = pipeline.isWorking || processingUploads > 0 || checklistSummary?.state === "processing" ||
    (artifactSummary?.processing ?? 0) > 0 || (artifactSummary?.queued ?? 0) > 0;

  // Determine polling interval based on busy state, visibility, and user activity
  // Live when: isBusy OR user recently acted
  const shouldBeLive = isBusy || userRecentlyActive;
  const pollInterval = !isVisible ? NO_POLL : shouldBeLive ? BUSY_POLL_MS : IDLE_POLL_MS;
  const isPolling = pollInterval > 0 && isVisible;

  const markUserAction = useCallback(() => {
    setLastUserActionAt(Date.now());
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fetchData = useCallback(async () => {
    if (!dealId) return;
    if (inflightRef.current) return;

    inflightRef.current = true;
    try {
      const [checklist, uploads, lifecycle, artifacts] = await Promise.all([
        fetchChecklistSummary(dealId),
        fetchUploadsStatus(dealId),
        fetchLifecycleState(dealId),
        fetchArtifactSummary(dealId),
      ]);

      setChecklistSummary(checklist);
      setProcessingUploads(uploads);
      setArtifactSummary(artifacts);
      setLastFetchedAt(new Date().toISOString());
      setError(null);
      setIsInitialLoading(false);
      consecutiveErrorsRef.current = 0;

      // Emit toast when new docs get classified
      if (artifacts) {
        const prevMatched = prevArtifactMatchedRef.current;
        const newMatched = artifacts.matched ?? 0;
        if (prevMatched > 0 && newMatched > prevMatched) {
          const delta = newMatched - prevMatched;
          setToasts((prev) => [...prev, {
            id: `artifact_matched_${Date.now()}`,
            type: "doc_classified" as const,
            title: `${delta} document${delta > 1 ? "s" : ""} classified`,
            ts: Date.now(),
          }].slice(-5));
        }
        prevArtifactMatchedRef.current = newMatched;
      }

      // Compute lifecycle diffs and emit toasts
      if (lifecycle) {
        const newToasts = computeLifecycleDiff(prevLifecycleRef.current, lifecycle);
        if (newToasts.length > 0) {
          setToasts((prev) => [...prev, ...newToasts].slice(-5)); // Keep last 5
        }
        prevLifecycleRef.current = lifecycle;
        setLifecycleState(lifecycle);
      }
    } catch (e: any) {
      consecutiveErrorsRef.current += 1;
      // Suppress transient errors — only surface after TRANSIENT_ERROR_THRESHOLD consecutive failures
      if (consecutiveErrorsRef.current >= TRANSIENT_ERROR_THRESHOLD) {
        setError(e?.message || "Failed to fetch cockpit data");
      }
    } finally {
      inflightRef.current = false;
    }
  }, [dealId]);

  // Auto-dismiss toasts after 4s
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.ts < 4000));
    }, 4000);
    return () => clearTimeout(timer);
  }, [toasts]);

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
    markUserAction(); // Refresh counts as user action
    await fetchData();
  }, [fetchData, markUserAction]);

  return {
    isBusy,
    isPolling,
    checklistSummary,
    processingUploads,
    artifactSummary,
    lastFetchedAt,
    error,
    refresh,
    isVisible,
    lifecycleState,
    toasts,
    dismissToast,
    markUserAction,
    userRecentlyActive,
    isInitialLoading,
  };
}

/**
 * Context for cockpit data - allows widgets to subscribe without re-fetching.
 */
import { createContext, useContext, type ReactNode } from "react";

const CockpitDataContext = createContext<CockpitData | null>(null);

export function CockpitDataProvider({
  dealId,
  initialLifecycleState,
  children,
}: {
  dealId: string;
  initialLifecycleState?: LifecycleState | null;
  children: ReactNode;
}) {
  const data = useCockpitData(dealId, initialLifecycleState);
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

/**
 * Hook to mark user actions (for Live indicator tracking).
 */
export function useMarkUserAction(): () => void {
  const ctx = useContext(CockpitDataContext);
  return ctx?.markUserAction ?? (() => {});
}
