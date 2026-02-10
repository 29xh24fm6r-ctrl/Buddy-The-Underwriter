"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AegisFinding {
  id: string;
  createdAt: string;
  eventType: string;
  severity: string;
  errorClass: string | null;
  errorCode: string | null;
  errorSignature: string | null;
  errorMessage: string | null;
  sourceSystem: string;
  sourceJobId: string | null;
  sourceJobTable: string | null;
  resolutionStatus: string;
  resolutionNote: string | null;
  retryAttempt: number | null;
  maxRetries: number | null;
  nextRetryAt: string | null;
  payload: Record<string, unknown> | null;
}

export type AegisHealthSeverity = "ok" | "degraded" | "alert";

export interface AegisHealthCounts {
  critical: number;
  error: number;
  warning: number;
  suppressed: number;
}

export interface AegisHealthState {
  severity: AegisHealthSeverity | null;
  counts: AegisHealthCounts | null;
  findings: AegisFinding[];
  loading: boolean;
  stale: boolean;
  error: string | null;
  lastRefresh: string | null;
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Poll Aegis health + findings endpoints for a deal.
 *
 * Fail-soft: on error preserves last-known data, sets stale = true.
 * Hydration-safe: state initialized to null, polling in useEffect only.
 *
 * Pattern follows useDegradedState (src/buddy/hooks/useDegradedState.ts).
 */
export function useAegisHealth({
  dealId,
  enabled = true,
  pollIntervalMs = 30_000,
}: {
  dealId: string | null;
  enabled?: boolean;
  pollIntervalMs?: number;
}): AegisHealthState {
  const [severity, setSeverity] = useState<AegisHealthSeverity | null>(null);
  const [counts, setCounts] = useState<AegisHealthCounts | null>(null);
  const [findings, setFindings] = useState<AegisFinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  // Track mounted state to avoid setState after unmount
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchHealth = useCallback(async () => {
    if (!enabled) return;

    try {
      setLoading(true);
      setError(null);

      const qs = dealId ? `?deal_id=${dealId}` : "";
      const [healthRes, findingsRes] = await Promise.all([
        fetch(`/api/aegis/health${qs}`).catch(() => null),
        dealId
          ? fetch(`/api/aegis/findings?deal_id=${dealId}`).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (!mounted.current) return;

      // Parse health
      if (healthRes && healthRes.ok) {
        const hData = await healthRes.json().catch(() => null);
        if (hData?.ok) {
          setSeverity(hData.severity ?? "ok");
          setCounts(hData.counts ?? null);
          setStale(false);
        }
      } else {
        // Mark stale but keep last-known values
        setStale(true);
      }

      // Parse findings
      if (findingsRes && findingsRes.ok) {
        const fData = await findingsRes.json().catch(() => null);
        if (fData?.ok && Array.isArray(fData.findings)) {
          setFindings(fData.findings);
        }
      }
      // Findings failure is non-fatal — keep previous findings

      setLastRefresh(new Date().toISOString());
    } catch (e) {
      if (!mounted.current) return;
      setError((e as Error)?.message ?? "Network error");
      setStale(true);
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  }, [dealId, enabled]);

  // Initial fetch
  useEffect(() => {
    if (enabled) {
      fetchHealth();
    }
  }, [enabled, fetchHealth]);

  // Polling
  useEffect(() => {
    if (!enabled || pollIntervalMs <= 0) return;

    const interval = setInterval(fetchHealth, pollIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, pollIntervalMs, fetchHealth]);

  return {
    severity,
    counts,
    findings,
    loading,
    stale,
    error,
    lastRefresh,
    refresh: fetchHealth,
  };
}
