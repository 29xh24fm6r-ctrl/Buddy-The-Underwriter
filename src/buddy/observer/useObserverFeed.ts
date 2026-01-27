/**
 * Observer Feed Hook — fetches health + omega events for builder panel.
 *
 * Client-side. Polls /api/buddy/observer/health and /events endpoints.
 * Returns aggregated diagnostics data.
 */
"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────

export type OmegaHealthData = {
  available: boolean;
  enabled: boolean;
  killed: boolean;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
};

export type OmegaEventEntry = {
  id: string;
  created_at: string;
  deal_id: string | null;
  type: string;
  source: string;
  payload: Record<string, unknown> | null;
};

export type DegradedInfo = {
  count: number;
  recent: unknown[];
};

export type ObserverFeedState = {
  loading: boolean;
  health: OmegaHealthData | null;
  degraded: DegradedInfo | null;
  events: OmegaEventEntry[];
  error: string | null;
  lastRefresh: string | null;
  refresh: () => void;
};

// ── Hook ──────────────────────────────────────────

export function useObserverFeed(opts?: {
  pollIntervalMs?: number;
  enabled?: boolean;
}): ObserverFeedState {
  const pollInterval = opts?.pollIntervalMs ?? 30_000;
  const enabled = opts?.enabled ?? true;

  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<OmegaHealthData | null>(null);
  const [degraded, setDegraded] = useState<DegradedInfo | null>(null);
  const [events, setEvents] = useState<OmegaEventEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const fetchFeed = useCallback(async () => {
    if (!enabled) return;
    try {
      setLoading(true);
      setError(null);

      // Fetch health + events in parallel
      const [healthRes, eventsRes] = await Promise.all([
        fetch("/api/buddy/observer/health").then((r) => r.json()).catch(() => null),
        fetch("/api/buddy/observer/events?limit=50").then((r) => r.json()).catch(() => null),
      ]);

      if (healthRes?.ok) {
        setHealth(healthRes.health ?? null);
        setDegraded(healthRes.degraded ?? null);
      }

      if (eventsRes?.ok) {
        setEvents(eventsRes.events ?? []);
      }

      if (!healthRes?.ok && !eventsRes?.ok) {
        setError(healthRes?.error?.message ?? eventsRes?.error?.message ?? "Feed unavailable");
      }

      setLastRefresh(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Feed fetch failed");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchFeed();
    if (!enabled) return;
    const interval = setInterval(fetchFeed, pollInterval);
    return () => clearInterval(interval);
  }, [fetchFeed, pollInterval, enabled]);

  return {
    loading,
    health,
    degraded,
    events,
    error,
    lastRefresh,
    refresh: fetchFeed,
  };
}
