"use client";

/**
 * Phase 13E — Work queue timeline activity cell.
 *
 * Fetches the latest unified timeline event for a deal via the existing
 * /api/brokerage/deals/[dealId]/timeline endpoint (limit=1) and renders
 * category + severity + short title + relative time, linked to the deal
 * timeline anchor.
 *
 * Invariants:
 * - Never queries raw source tables; consumes the redacted timeline API only.
 * - Renders only the redacted fields the API returns (title, description,
 *   category, severity, timestamp). Never touches raw body fields.
 * - On fetch failure, falls back to the existing latestActivityAt timestamp
 *   so the queue cell never appears empty if the deal has any activity record.
 * - Empty (no events) → "No recent activity."
 */

import { useEffect, useState } from "react";
import Link from "next/link";

type TimelineCategory = "document" | "readiness" | "comms" | "banker_action" | "system";
type TimelineSeverity = "info" | "success" | "warning" | "error";

type LatestActivity = {
  category: TimelineCategory;
  severity: TimelineSeverity;
  title: string;
  timestamp: string;
};

type ExternalTimelineEvent = {
  category?: unknown;
  severity?: unknown;
  title?: unknown;
  timestamp?: unknown;
};

export type WorkQueueLatestEvent = {
  event: ExternalTimelineEvent | null;
};

type Props = {
  dealId: string;
  fallbackTimestamp: string | null;
  prefetched?: WorkQueueLatestEvent | null;
};

const CATEGORY_DOT: Record<TimelineCategory, string> = {
  document: "bg-blue-400",
  readiness: "bg-emerald-400",
  comms: "bg-violet-400",
  banker_action: "bg-amber-400",
  system: "bg-neutral-400",
};

const SEVERITY_BORDER: Record<TimelineSeverity, string> = {
  info: "border-white/10",
  success: "border-emerald-500/30",
  warning: "border-amber-500/30",
  error: "border-red-500/30",
};

const VALID_CATEGORIES: ReadonlyArray<TimelineCategory> = ["document", "readiness", "comms", "banker_action", "system"];
const VALID_SEVERITIES: ReadonlyArray<TimelineSeverity> = ["info", "success", "warning", "error"];

function shortenTitle(raw: string, max = 36): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1).trimEnd() + "…";
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function normalizeEventShape(first: Record<string, unknown> | null | undefined): LatestActivity | null {
  if (!first || typeof first !== "object") return null;
  const category = first.category;
  const severity = first.severity;
  const title = first.title;
  const timestamp = first.timestamp;
  if (typeof title !== "string" || typeof timestamp !== "string") return null;
  if (typeof category !== "string" || !VALID_CATEGORIES.includes(category as TimelineCategory)) return null;
  if (typeof severity !== "string" || !VALID_SEVERITIES.includes(severity as TimelineSeverity)) return null;
  return {
    category: category as TimelineCategory,
    severity: severity as TimelineSeverity,
    title,
    timestamp,
  };
}

function parseLatestEvent(payload: unknown): LatestActivity | null {
  if (!payload || typeof payload !== "object") return null;
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length === 0) return null;
  return normalizeEventShape(events[0] as Record<string, unknown> | undefined);
}

export default function WorkQueueTimelineActivity({ dealId, fallbackTimestamp, prefetched }: Props) {
  const hasPrefetch = prefetched !== undefined && prefetched !== null;
  const prefetchedLatest = hasPrefetch ? normalizeEventShape(prefetched!.event as Record<string, unknown> | null | undefined) : null;

  const [latest, setLatest] = useState<LatestActivity | null>(prefetchedLatest);
  const [loaded, setLoaded] = useState<boolean>(hasPrefetch);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (hasPrefetch) {
      setLatest(prefetchedLatest);
      setLoaded(true);
      setFailed(false);
      return;
    }

    let cancelled = false;
    fetch(`/api/brokerage/deals/${dealId}/timeline?limit=1`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        const parsed = parseLatestEvent(json);
        setLatest(parsed);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, hasPrefetch, prefetched?.event]);

  const href = `/deals/${dealId}#timeline`;

  // Still loading — render fallback relative time so the cell never flashes empty.
  if (!loaded) {
    return (
      <span className="text-white/40" data-testid="work-queue-timeline-activity-loading">
        {formatRelativeTime(fallbackTimestamp)}
      </span>
    );
  }

  // Fetch failed — keep the legacy timestamp visible; link still works.
  if (failed) {
    return (
      <Link
        href={href}
        className="text-white/40 hover:text-white/70"
        data-testid="work-queue-timeline-activity-fallback"
      >
        {formatRelativeTime(fallbackTimestamp)}
      </Link>
    );
  }

  // No events at all.
  if (!latest) {
    return (
      <Link
        href={href}
        className="text-white/30 hover:text-white/60 italic"
        data-testid="work-queue-timeline-activity-empty"
      >
        No recent activity.
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`flex flex-col gap-0.5 rounded-md border ${SEVERITY_BORDER[latest.severity]} px-2 py-1 hover:bg-white/[0.04] transition`}
      data-testid="work-queue-timeline-activity"
      data-category={latest.category}
      data-severity={latest.severity}
      data-timestamp={latest.timestamp}
    >
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${CATEGORY_DOT[latest.category]}`} aria-hidden />
        <span className="text-[10px] uppercase tracking-wide text-white/40">{latest.category.replace(/_/g, " ")}</span>
      </span>
      <span className="text-xs text-white/80" title={latest.title}>
        {shortenTitle(latest.title)}
      </span>
      <span className="text-[10px] text-white/40">{formatRelativeTime(latest.timestamp)}</span>
    </Link>
  );
}

// Exposed for unit tests.
export const __internal = { shortenTitle, formatRelativeTime, parseLatestEvent, normalizeEventShape };
