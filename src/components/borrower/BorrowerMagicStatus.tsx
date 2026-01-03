"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type BorrowerStatusResponse = {
  ok: boolean;
  stage: "reviewing" | "needs_more" | "complete" | "blocked";
  message: string;
  detail?: string;
  lastActivity?: string;
};

export function BorrowerMagicStatus({ token }: { token: string }) {
  const [status, setStatus] = React.useState<BorrowerStatusResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${token}/status`);
      if (!res.ok) throw new Error("Failed to load status");
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error("Status fetch error:", e);
      // Silent fail - no scary errors for borrowers
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    fetchStatus();
    // Refresh every 15s
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Handle visibility change - pause when hidden
  React.useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchStatus();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchStatus]);

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-neutral-100" />
          <div className="flex-1">
            <div className="h-4 w-32 rounded bg-neutral-100" />
            <div className="mt-2 h-3 w-48 rounded bg-neutral-100" />
          </div>
        </div>
      </div>
    );
  }

  if (!status || !status.ok) {
    return null; // Silent fail for borrowers
  }

  const { stage, message, detail, lastActivity } = status;

  // Color & icon based on stage
  const config = {
    reviewing: {
      color: "amber",
      icon: "pending" as const,
      borderClass: "border-amber-200 bg-amber-50",
      iconClass: "text-amber-600",
      textClass: "text-amber-900",
    },
    needs_more: {
      color: "amber",
      icon: "error" as const,
      borderClass: "border-amber-200 bg-amber-50",
      iconClass: "text-amber-600",
      textClass: "text-amber-900",
    },
    complete: {
      color: "emerald",
      icon: "check_circle" as const,
      borderClass: "border-emerald-200 bg-emerald-50",
      iconClass: "text-emerald-600",
      textClass: "text-emerald-900",
    },
    blocked: {
      color: "red",
      icon: "error" as const,
      borderClass: "border-red-200 bg-red-50",
      iconClass: "text-red-600",
      textClass: "text-red-900",
    },
  }[stage];

  const timeAgoText = lastActivity ? formatTimeAgo(lastActivity) : null;

  return (
    <div className={`rounded-xl border p-4 ${config.borderClass}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white`}>
          <Icon name={config.icon} className={`h-5 w-5 ${config.iconClass}`} />
        </div>
        <div className="flex-1">
          <div className={`text-sm font-semibold ${config.textClass}`}>{message}</div>
          {detail && (
            <div className={`mt-1 text-xs ${config.textClass} opacity-90`}>{detail}</div>
          )}
          {timeAgoText && stage !== "complete" && (
            <div className={`mt-2 text-xs ${config.textClass} opacity-75`}>
              {timeAgoText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return "Last upload received just now";
  if (diffSec < 60) return `Last upload received ${diffSec}s ago`;
  
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Last upload received ${diffMin}m ago`;
  
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `Last upload received ${diffHour}h ago`;
  
  const diffDay = Math.floor(diffHour / 24);
  return `Last upload received ${diffDay}d ago`;
}
