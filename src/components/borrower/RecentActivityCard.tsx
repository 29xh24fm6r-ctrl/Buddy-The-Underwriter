// src/components/borrower/RecentActivityCard.tsx
"use client";

import React from "react";
import type { PortalActivityItem } from "@/lib/borrower/portalTypes";

function getIcon(icon?: string | null) {
  const i = String(icon || "").toLowerCase();
  if (i === "check") return "✓";
  if (i === "upload") return "↑";
  if (i === "sparkles") return "✨";
  if (i === "info") return "ℹ";
  return "•";
}

function getIconClasses(icon?: string | null) {
  const i = String(icon || "").toLowerCase();
  if (i === "check") return "bg-green-100 text-green-700 border-green-200";
  if (i === "upload") return "bg-blue-100 text-blue-700 border-blue-200";
  if (i === "sparkles") return "bg-purple-100 text-purple-700 border-purple-200";
  return "bg-muted text-foreground border";
}

function timeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function RecentActivityCard({
  activities,
}: {
  activities: PortalActivityItem[];
}) {
  const items = (activities || []).slice(0, 10); // Show last 10

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold">Recent activity</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Upload a document to see real-time recognition and filing updates here.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold">Recent activity</div>
      <div className="mt-1 text-sm text-muted-foreground">
        Watch as we recognize and organize your uploads automatically
      </div>

      <div className="mt-4 space-y-3">
        {items.map((item, idx) => (
          <div
            key={item.id || `activity-${idx}`}
            className="flex items-start gap-3 rounded-xl border bg-muted/20 p-3"
          >
            {/* Icon */}
            <div
              className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold ${getIconClasses(item.icon)}`}
            >
              {getIcon(item.icon)}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold">{item.title}</div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {timeAgo(item.timestamp)}
                </div>
              </div>

              {!!item.description && (
                <div className="mt-1 text-sm text-muted-foreground">
                  {item.description}
                </div>
              )}

              {!!item.filename && (
                <div className="mt-2 text-xs text-muted-foreground">
                  File: <span className="font-medium text-foreground">{item.filename}</span>
                </div>
              )}

              {typeof item.confidence === "number" && item.confidence > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-foreground"
                      style={{ width: `${Math.round(item.confidence * 100)}%` }}
                    />
                  </div>
                  <div className="text-xs font-semibold text-muted-foreground">
                    {Math.round(item.confidence * 100)}%
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        All uploads are auto-filed — no manual sorting needed
      </div>
    </div>
  );
}
