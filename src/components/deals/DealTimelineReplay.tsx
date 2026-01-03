"use client";

import { useEffect, useState } from "react";
import { PIPELINE_COPY } from "@/lib/pipeline/pipelineCopy";

type TimelineEvent = {
  event_key: string;
  ui_state: "working" | "waiting" | "done";
  ui_message: string;
  created_at: string;
};

type Props = {
  dealId: string;
  limit?: number;
};

/**
 * 📜 Replayable Timeline
 * 
 * Shows chronological pipeline events as narrative timeline.
 * Static snapshot (no polling) for "what happened" view.
 * 
 * Usage:
 * <DealTimelineReplay dealId={dealId} limit={20} />
 */
export function DealTimelineReplay({ dealId, limit = 20 }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTimeline = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(
          `/api/deals/${dealId}/pipeline/timeline?limit=${limit}`,
          { cache: "no-store" }
        );

        const data = await res.json();

        if (!data.ok) {
          throw new Error(data.error || "Failed to fetch timeline");
        }

        setEvents(data.events || []);
      } catch (e: any) {
        console.error("[DealTimelineReplay] Error:", e);
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    };

    if (dealId) {
      void fetchTimeline();
    }
  }, [dealId, limit]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="text-sm text-red-700">Failed to load timeline</div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
        <div className="text-sm text-gray-600">No pipeline events yet</div>
        <div className="mt-1 text-xs text-gray-500">
          Events will appear here as documents are uploaded and processed
        </div>
      </div>
    );
  }

  const getEventIcon = (uiState: string) => {
    if (uiState === "working") return "⚙️";
    if (uiState === "waiting") return "⏸️";
    if (uiState === "done") return "✅";
    return "📌";
  };

  const getRelativeTime = (timestamp: string) => {
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
  };

  return (
    <div className="space-y-1">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Pipeline Timeline</h3>
        <div className="text-xs text-gray-500">{events.length} events</div>
      </div>

      <div className="relative space-y-4">
        {/* Vertical timeline line */}
        <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-200" />

        {events.map((event, idx) => {
          const isLast = idx === events.length - 1;
          const copy = PIPELINE_COPY[event.ui_state];

          return (
            <div key={`${event.created_at}-${idx}`} className="relative flex items-start gap-3">
              {/* Timeline dot */}
              <div
                className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                  isLast
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-300 bg-white"
                }`}
              >
                <span className="text-sm">{getEventIcon(event.ui_state)}</span>
              </div>

              {/* Event content */}
              <div className="flex-1 pb-2">
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">
                        {event.ui_message || copy.short}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {event.event_key.replace(/_/g, " ")}
                      </div>
                    </div>
                    <div className="text-xs text-gray-400">
                      {getRelativeTime(event.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
