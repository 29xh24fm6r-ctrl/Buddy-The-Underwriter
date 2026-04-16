"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  circuitOpen: boolean;
  refresh: () => void;
}

const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Hook to fetch and track degraded API responses for a deal.
 * Used by Builder Observer to show reliability issues.
 *
 * Includes a circuit breaker: after 3 consecutive failures, polling stops
 * to prevent a degradation monitor from causing degradation. Call refresh()
 * to reset the circuit breaker and retry.
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
  const [circuitOpen, setCircuitOpen] = useState(false);
  const consecutiveFailuresRef = useRef(0);

  const fetch_ = useCallback(async () => {
    if (!dealId || !enabled || circuitOpen) return;

    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/buddy/degraded?dealId=${dealId}`);
      const data = await res.json();

      if (data.ok) {
        consecutiveFailuresRef.current = 0;
        setItems(data.items ?? []);
      } else {
        throw new Error(data.error ?? "Failed to fetch degraded state");
      }
    } catch (e) {
      consecutiveFailuresRef.current += 1;
      setError((e as Error)?.message ?? "Network error");
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setCircuitOpen(true);
      }
    } finally {
      setLoading(false);
    }
  }, [dealId, enabled, circuitOpen]);

  // Initial fetch
  useEffect(() => {
    if (dealId && enabled) {
      fetch_();
    }
  }, [dealId, enabled, fetch_]);

  // Polling
  useEffect(() => {
    if (!dealId || !enabled || pollInterval <= 0 || circuitOpen) return;

    const interval = setInterval(fetch_, pollInterval);
    return () => clearInterval(interval);
  }, [dealId, enabled, pollInterval, fetch_, circuitOpen]);

  return {
    degraded: items.length > 0,
    items,
    loading,
    error,
    circuitOpen,
    refresh: () => {
      consecutiveFailuresRef.current = 0;
      setCircuitOpen(false);
      fetch_();
    },
  };
}
