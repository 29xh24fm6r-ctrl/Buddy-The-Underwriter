/**
 * Observer Badges — small status indicators for omega health.
 *
 * Shows: connection status, latency, kill switch, failure count.
 * Client-side component.
 */
"use client";

import React from "react";
import type { OmegaHealthData, DegradedInfo } from "./useObserverFeed";

// ── Badge Components ──────────────────────────────

function Badge({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: "ok" | "warn" | "error" | "neutral";
}) {
  const colors: Record<string, string> = {
    ok: "bg-green-100 text-green-800 border-green-200",
    warn: "bg-yellow-100 text-yellow-800 border-yellow-200",
    error: "bg-red-100 text-red-800 border-red-200",
    neutral: "bg-gray-100 text-gray-700 border-gray-200",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${colors[variant]}`}
    >
      <span className="opacity-60">{label}:</span>
      <span>{value}</span>
    </span>
  );
}

// ── Main Component ────────────────────────────────

export function ObserverBadges({
  health,
  degraded,
}: {
  health: OmegaHealthData | null;
  degraded: DegradedInfo | null;
}) {
  if (!health) {
    return (
      <div className="flex gap-2 flex-wrap">
        <Badge label="Omega" value="Loading..." variant="neutral" />
      </div>
    );
  }

  const connectionVariant: "ok" | "warn" | "error" | "neutral" = health.killed
    ? "error"
    : health.available
      ? "ok"
      : health.enabled
        ? "warn"
        : "neutral";

  const connectionLabel = health.killed
    ? "KILLED"
    : health.available
      ? "Connected"
      : health.enabled
        ? "Unavailable"
        : "Disabled";

  const latencyVariant: "ok" | "warn" | "error" | "neutral" =
    health.latencyMs === null
      ? "neutral"
      : health.latencyMs < 1000
        ? "ok"
        : health.latencyMs < 3000
          ? "warn"
          : "error";

  return (
    <div className="flex gap-2 flex-wrap">
      <Badge label="Omega" value={connectionLabel} variant={connectionVariant} />
      {health.latencyMs !== null && (
        <Badge
          label="Latency"
          value={`${health.latencyMs}ms`}
          variant={latencyVariant}
        />
      )}
      {health.error && (
        <Badge label="Error" value={health.error} variant="error" />
      )}
      {degraded && degraded.count > 0 && (
        <Badge
          label="Degraded"
          value={String(degraded.count)}
          variant="warn"
        />
      )}
    </div>
  );
}
