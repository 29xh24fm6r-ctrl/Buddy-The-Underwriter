"use client";

import { useCallback, useEffect, useState } from "react";

export interface DegradedEvent {
  id: string;
  ts: string;
  endpoint: string;
  code: string;
  message: string;
  correlationId: string;
}

export interface DegradedState {
  degraded: boolean;
  items: DegradedEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Hook to fetch and track degraded API responses for a deal.
 * Used by Builder Observer to show reliability issues.
 *
 * @param dealId - The deal to monitor
 * @param enabled - Whether to poll (default: true)
 * @param pollInterval - How often to poll in ms (default: 30000)
 */
export function useDegradedState(
  dealId: string | null,
  enabled: boolean = true,
  pollInterval: number = 30_000
): DegradedState {
  const [items, setItems] = useState<DegradedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!dealId || !enabled) return;

    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/buddy/degraded?dealId=${dealId}`);
      const data = await res.json();

      if (data.ok) {
        setItems(data.items ?? []);
      } else {
        setError(data.error ?? "Failed to fetch degraded state");
      }
    } catch (e) {
      setError((e as Error)?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, [dealId, enabled]);

  // Initial fetch
  useEffect(() => {
    if (dealId && enabled) {
      fetch_();
    }
  }, [dealId, enabled, fetch_]);

  // Polling
  useEffect(() => {
    if (!dealId || !enabled || pollInterval <= 0) return;

    const interval = setInterval(fetch_, pollInterval);
    return () => clearInterval(interval);
  }, [dealId, enabled, pollInterval, fetch_]);

  return {
    degraded: items.length > 0,
    items,
    loading,
    error,
    refresh: fetch_,
  };
}
