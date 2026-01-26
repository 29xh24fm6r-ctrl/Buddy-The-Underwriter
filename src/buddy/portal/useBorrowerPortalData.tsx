"use client";

import { useEffect, useRef, useState, useCallback, createContext, useContext, type ReactNode } from "react";

/**
 * Borrower Portal Data Hook
 *
 * Mirrors cockpit's smart polling for the borrower side:
 * - Tracks upload processing state
 * - Emits borrower-safe "what changed" toasts
 * - Live/Idle indicator support
 *
 * Goals:
 * - Instant acknowledgement when borrower uploads
 * - Progress updates without refreshing
 * - Borrower-friendly language (no internal jargon)
 */

// Polling intervals
const PROCESSING_POLL_MS = 3000; // 3s when processing
const IDLE_POLL_MS = 15000; // 15s when idle
const NO_POLL = 0;
const USER_ACTION_TIMEOUT_MS = 30000; // 30s after user action

export type BorrowerToast = {
  id: string;
  type: "upload_received" | "doc_classified" | "progress" | "missing_alert" | "all_done";
  title: string;
  detail?: string;
  ts: number;
};

export type BorrowerPortalData = {
  /** Deal ID */
  dealId: string | null;
  /** Whether uploads are currently processing */
  isProcessing: boolean;
  /** Number of uploads being processed */
  processingCount: number;
  /** Whether polling is active */
  isPolling: boolean;
  /** Whether tab is visible */
  isVisible: boolean;
  /** Active toasts */
  toasts: BorrowerToast[];
  /** Dismiss a toast */
  dismissToast: (id: string) => void;
  /** Mark user action (upload, message, etc.) */
  markUserAction: () => void;
  /** Whether user has acted recently */
  userRecentlyActive: boolean;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
  /** Emit a toast */
  pushToast: (toast: Omit<BorrowerToast, "id" | "ts">) => void;
  /** Current progress (if available) */
  progress: { percent: number; done: number; total: number } | null;
  /** List of recently received items for diff tracking */
  recentlyReceived: string[];
};

async function fetchUploadStatus(dealId: string, token: string | null): Promise<number> {
  if (!token) return 0;
  try {
    const res = await fetch(`/api/portal/deals/${dealId}/uploads/status`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = await res.json();
    return json.processing || 0;
  } catch {
    return 0;
  }
}

export function useBorrowerPortalData(dealId: string | null): BorrowerPortalData {
  const [processingCount, setProcessingCount] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [toasts, setToasts] = useState<BorrowerToast[]>([]);
  const [lastUserActionAt, setLastUserActionAt] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ percent: number; done: number; total: number } | null>(null);
  const [recentlyReceived, setRecentlyReceived] = useState<string[]>([]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);

  // Get token from localStorage (borrower portal pattern)
  const getToken = useCallback(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("buddy_invite_token");
  }, []);

  const userRecentlyActive = lastUserActionAt !== null && Date.now() - lastUserActionAt < USER_ACTION_TIMEOUT_MS;
  const isProcessing = processingCount > 0;
  const shouldBeLive = isProcessing || userRecentlyActive;
  const pollInterval = !isVisible ? NO_POLL : shouldBeLive ? PROCESSING_POLL_MS : IDLE_POLL_MS;
  const isPolling = pollInterval > 0 && isVisible;

  const markUserAction = useCallback(() => {
    setLastUserActionAt(Date.now());
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<BorrowerToast, "id" | "ts">) => {
    const now = Date.now();
    setToasts((prev) => [
      ...prev,
      { ...toast, id: `${toast.type}_${now}`, ts: now },
    ].slice(-5));
  }, []);

  const fetchData = useCallback(async () => {
    if (!dealId) return;
    if (inflightRef.current) return;

    const token = getToken();
    if (!token) return;

    inflightRef.current = true;
    try {
      const processing = await fetchUploadStatus(dealId, token);

      // Detect transition from processing to done
      if (processingCount > 0 && processing === 0) {
        pushToast({
          type: "upload_received",
          title: "Upload complete",
          detail: "Your document has been received and is being processed.",
        });
      }

      setProcessingCount(processing);
    } catch {
      // Silently fail on borrower side
    } finally {
      inflightRef.current = false;
    }
  }, [dealId, getToken, processingCount, pushToast]);

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

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    void fetchData();

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
    markUserAction();
    await fetchData();
  }, [fetchData, markUserAction]);

  return {
    dealId,
    isProcessing,
    processingCount,
    isPolling,
    isVisible,
    toasts,
    dismissToast,
    markUserAction,
    userRecentlyActive,
    refresh,
    pushToast,
    progress,
    recentlyReceived,
  };
}

/**
 * Context for borrower portal data
 */
const BorrowerPortalDataContext = createContext<BorrowerPortalData | null>(null);

export function BorrowerPortalDataProvider({
  dealId,
  children,
}: {
  dealId: string;
  children: ReactNode;
}) {
  const data = useBorrowerPortalData(dealId);
  return (
    <BorrowerPortalDataContext.Provider value={data}>
      {children}
    </BorrowerPortalDataContext.Provider>
  );
}

export function useBorrowerPortalDataContext(): BorrowerPortalData {
  const ctx = useContext(BorrowerPortalDataContext);
  if (!ctx) {
    throw new Error("useBorrowerPortalDataContext must be used within BorrowerPortalDataProvider");
  }
  return ctx;
}

/**
 * Hook for borrower components that just need Live/Idle info
 */
export function useBorrowerShouldPoll(): { shouldPoll: boolean; isProcessing: boolean } {
  const ctx = useContext(BorrowerPortalDataContext);
  if (!ctx) {
    return { shouldPoll: false, isProcessing: false };
  }
  return {
    shouldPoll: ctx.isPolling,
    isProcessing: ctx.isProcessing,
  };
}

/**
 * Hook to mark borrower actions
 */
export function useBorrowerMarkAction(): () => void {
  const ctx = useContext(BorrowerPortalDataContext);
  return ctx?.markUserAction ?? (() => {});
}

/**
 * Hook to push borrower-friendly toasts
 */
export function useBorrowerPushToast(): (toast: Omit<BorrowerToast, "id" | "ts">) => void {
  const ctx = useContext(BorrowerPortalDataContext);
  return ctx?.pushToast ?? (() => {});
}
