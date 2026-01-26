"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useDegradedState, type DegradedEvent } from "@/buddy/hooks/useDegradedState";

interface DegradedBannerProps {
  dealId: string | null;
  enabled?: boolean;
}

/**
 * Builder Observer banner that shows when API endpoints are degraded.
 * Only visible when BUDDY_BUILDER_MODE or BUDDY_OBSERVER_MODE is enabled.
 */
export function DegradedBanner({ dealId, enabled = true }: DegradedBannerProps) {
  const isBuilderMode =
    typeof window !== "undefined" &&
    (process.env.NEXT_PUBLIC_BUDDY_OBSERVER_MODE === "1" ||
      process.env.NEXT_PUBLIC_BUDDY_BUILDER_MODE === "1");

  const { degraded, items, refresh } = useDegradedState(dealId, enabled && isBuilderMode);
  const [expanded, setExpanded] = useState(false);

  const copyDiagnostics = useCallback(() => {
    const diagnostics = items
      .map(
        (item) =>
          `[${item.ts}] ${item.endpoint}\n  code: ${item.code}\n  message: ${item.message}\n  correlationId: ${item.correlationId}`
      )
      .join("\n\n");

    const fullDiagnostics = `DEGRADED API RESPONSES\ndealId: ${dealId}\ntime: ${new Date().toISOString()}\n\n${diagnostics}`;

    navigator.clipboard.writeText(fullDiagnostics).then(() => {
      // Could show a toast here
    });
  }, [dealId, items]);

  // Group by endpoint for display
  const grouped = useMemo(() => {
    const map = new Map<string, DegradedEvent[]>();
    for (const item of items) {
      const existing = map.get(item.endpoint) ?? [];
      existing.push(item);
      map.set(item.endpoint, existing);
    }
    return map;
  }, [items]);

  if (!isBuilderMode || !degraded) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: "#fef3c7",
        border: "1px solid #f59e0b",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 13,
        fontFamily: "system-ui, sans-serif",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        maxWidth: 500,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, color: "#92400e" }}>Degraded</span>
        <span style={{ color: "#78350f" }}>
          {Array.from(grouped.entries())
            .map(([endpoint, events]) => `${endpoint.split("/").pop()} (${events.length})`)
            .join(", ")}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 6px",
            fontSize: 12,
            color: "#92400e",
          }}
        >
          {expanded ? "Hide" : "Details"}
        </button>
        <button
          onClick={copyDiagnostics}
          style={{
            background: "#f59e0b",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            padding: "4px 8px",
            fontSize: 12,
            color: "white",
            fontWeight: 500,
          }}
        >
          Copy Diagnostics
        </button>
        <button
          onClick={refresh}
          style={{
            background: "none",
            border: "1px solid #f59e0b",
            borderRadius: 4,
            cursor: "pointer",
            padding: "2px 6px",
            fontSize: 11,
            color: "#92400e",
          }}
        >
          Refresh
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#78350f" }}>
          {Array.from(grouped.entries()).map(([endpoint, events]) => (
            <div key={endpoint} style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 600 }}>{endpoint}</div>
              {events.slice(0, 3).map((event) => (
                <div key={event.id} style={{ paddingLeft: 8, opacity: 0.9 }}>
                  <span style={{ fontFamily: "monospace" }}>{event.code}</span>
                  {" - "}
                  <span style={{ fontFamily: "monospace", fontSize: 10 }}>
                    {event.correlationId}
                  </span>
                </div>
              ))}
              {events.length > 3 && (
                <div style={{ paddingLeft: 8, opacity: 0.7 }}>...and {events.length - 3} more</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
