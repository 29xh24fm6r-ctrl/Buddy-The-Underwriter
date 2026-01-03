"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type TimelineEvent = {
  id: string;
  ts: string;
  kind: string;
  title: string;
  detail?: string;
  status?: "started" | "completed" | "blocked" | "failed" | "info";
};

type TimelineResponse = {
  ok: boolean;
  events?: TimelineEvent[];
  error?: string;
};

export function CinematicTimeline({ dealId }: { dealId: string }) {
  const [data, setData] = React.useState<TimelineResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchTimeline = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/timeline?simple=true`);
      if (!res.ok) throw new Error("Failed to load timeline");
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error("Timeline error:", e);
      setData({ ok: false, error: "Failed to load timeline" });
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  React.useEffect(() => {
    fetchTimeline();
    // Refresh every 15s
    const interval = setInterval(fetchTimeline, 15000);
    return () => clearInterval(interval);
  }, [fetchTimeline]);

  // Pause polling when hidden
  React.useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchTimeline();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchTimeline]);

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="h-4 w-32 rounded bg-neutral-100" />
        <div className="mt-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="h-8 w-8 rounded-full bg-neutral-100" />
              <div className="flex-1">
                <div className="h-3 w-48 rounded bg-neutral-100" />
                <div className="mt-1 h-2 w-32 rounded bg-neutral-50" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data || !data.ok || !data.events || data.events.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-6">
        <div className="flex items-center gap-2 text-neutral-600">
          <Icon name="history" className="h-5 w-5" />
          <div className="text-sm">No activity yet — upload docs to begin.</div>
        </div>
      </div>
    );
  }

  const events = data.events;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="history" className="h-5 w-5 text-neutral-600" />
        <div className="text-sm font-semibold">Deal Timeline</div>
      </div>

      <div className="space-y-4">
        {events.map((event, idx) => {
          const isFirst = idx === 0;
          const config = getEventConfig(event);

          return (
            <div key={event.id} className="flex gap-3">
              {/* Timeline connector line */}
              <div className="relative flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full ${isFirst ? "bg-blue-100" : "bg-neutral-100"
                    }`}
                >
                  <Icon
                    name={config.icon}
                    className={`h-4 w-4 ${isFirst ? "text-blue-600" : "text-neutral-600"
                      }`}
                  />
                </div>
                {idx < events.length - 1 && (
                  <div className="w-0.5 flex-1 bg-neutral-200" style={{ minHeight: "1rem" }} />
                )}
              </div>

              {/* Event content */}
              <div className="flex-1 pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium text-neutral-900">
                    {event.title}
                  </div>
                  <div className="shrink-0 text-xs text-neutral-500">
                    {formatTimeAgo(event.ts)}
                  </div>
                </div>
                {event.detail && (
                  <div className="mt-1 text-xs text-neutral-600">{event.detail}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getEventConfig(event: TimelineEvent): { icon: "cloud_upload" | "description" | "auto_awesome" | "checklist" | "check_circle" | "pending" | "event" } {
  const kindMap: Record<string, "cloud_upload" | "description" | "auto_awesome" | "checklist" | "check_circle" | "pending" | "event"> = {
    upload: "cloud_upload",
    doc_received: "description",
    auto_seed: "auto_awesome",
    checklist: "checklist",
    readiness: "check_circle",
    ocr: "pending",
    ai: "auto_awesome",
    other: "event",
  };

  const icon = kindMap[event.kind] ?? "event";

  return { icon };
}

function formatTimeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}
