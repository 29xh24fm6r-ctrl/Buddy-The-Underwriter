"use client";

import { useBorrowerShouldPoll, useBorrowerPortalDataContext } from "@/buddy/portal/useBorrowerPortalData";
import { cn } from "@/lib/utils";

/**
 * Borrower Live Indicator
 *
 * Shows whether the portal is actively tracking updates.
 * - Green pulsing dot + "Syncing" when processing or user active
 * - Gray dot + "Watching" when idle
 *
 * Uses calmer, borrower-friendly language (not "Live/Idle").
 */
export function BorrowerLiveIndicator() {
  const { shouldPoll, isProcessing } = useBorrowerShouldPoll();

  // Try to get full context for more detail
  let processingCount = 0;
  let userActive = false;
  try {
    const ctx = useBorrowerPortalDataContext();
    processingCount = ctx.processingCount;
    userActive = ctx.userRecentlyActive;
  } catch {
    // Not in context
  }

  const status = isProcessing ? "processing" : userActive ? "active" : "watching";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        shouldPoll
          ? "bg-blue-50 text-blue-700 border border-blue-200"
          : "bg-gray-50 text-gray-500 border border-gray-200"
      )}
      title={
        status === "processing"
          ? "We're processing your upload"
          : status === "active"
            ? "Watching for updates"
            : "Portal is idle"
      }
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          shouldPoll ? "bg-blue-500 animate-pulse" : "bg-gray-400"
        )}
      />
      <span>
        {status === "processing"
          ? processingCount > 1
            ? `Processing ${processingCount} files`
            : "Processing..."
          : status === "active"
            ? "Syncing"
            : "Watching"}
      </span>
    </div>
  );
}

/**
 * Borrower Processing Banner
 *
 * Shows when uploads are being processed.
 * Calmer than cockpit version - borrower-friendly messaging.
 */
export function BorrowerProcessingBanner() {
  let processingCount = 0;
  try {
    const ctx = useBorrowerPortalDataContext();
    processingCount = ctx.processingCount;
  } catch {
    return null;
  }

  if (processingCount === 0) return null;

  return (
    <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800">
      <div className="flex items-center gap-2">
        <span className="animate-spin h-4 w-4 border-2 border-blue-300 border-t-blue-600 rounded-full" />
        <span>
          {processingCount > 1
            ? `Processing ${processingCount} uploads...`
            : "Processing your upload..."}
        </span>
        <span className="text-blue-600/70 text-xs">(usually under 10 seconds)</span>
      </div>
    </div>
  );
}

/**
 * Borrower Toast Stack
 *
 * Displays toasts for:
 * - "Received: 2022-2024 Personal Returns"
 * - "Classified: Rent Roll"
 * - "You're missing: Bank statements"
 */
export function BorrowerToastStack() {
  let toasts: Array<{ id: string; type: string; title: string; detail?: string; ts: number }> = [];
  let dismissToast: (id: string) => void = () => {};
  try {
    const ctx = useBorrowerPortalDataContext();
    toasts = ctx.toasts;
    dismissToast = ctx.dismissToast;
  } catch {
    return null;
  }

  if (toasts.length === 0) return null;

  const getToastStyle = (type: string) => {
    switch (type) {
      case "upload_received":
        return "border-green-200 bg-green-50 text-green-800";
      case "doc_classified":
        return "border-blue-200 bg-blue-50 text-blue-800";
      case "progress":
        return "border-purple-200 bg-purple-50 text-purple-800";
      case "missing_alert":
        return "border-amber-200 bg-amber-50 text-amber-800";
      case "all_done":
        return "border-green-200 bg-green-50 text-green-800";
      default:
        return "border-gray-200 bg-white text-gray-800";
    }
  };

  const getToastIcon = (type: string) => {
    switch (type) {
      case "upload_received":
        return "✓";
      case "doc_classified":
        return "📄";
      case "progress":
        return "📈";
      case "missing_alert":
        return "📋";
      case "all_done":
        return "🎉";
      default:
        return "ℹ";
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[320px] pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto animate-in fade-in slide-in-from-right-2 rounded-xl border p-3 shadow-md",
            getToastStyle(toast.type)
          )}
        >
          <div className="flex items-start gap-2">
            <span className="text-lg">{getToastIcon(toast.type)}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{toast.title}</div>
              {toast.detail && (
                <div className="mt-0.5 text-xs opacity-80">{toast.detail}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="text-current opacity-40 hover:opacity-80 transition-opacity"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
