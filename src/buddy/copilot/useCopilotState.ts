/**
 * Copilot State Hook — fetches omega confidence + state for banker UI.
 *
 * Client-side. Calls internal API endpoints that proxy to omega.
 * Degrades gracefully when omega unavailable.
 */
"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────

export type CopilotConfidence = {
  available: boolean;
  confidence: number | null; // 0.0–1.0
  recommendation: "proceed" | "clarify" | "block" | null;
  explanation: string | null;
};

export type CopilotState = {
  loading: boolean;
  confidence: CopilotConfidence;
  omegaAvailable: boolean;
  error: string | null;
  correlationId: string | null;
  refresh: () => void;
};

// ── Hook ──────────────────────────────────────────

/**
 * Fetch omega confidence for an underwriting case.
 *
 * Uses the borrower debug endpoint to piggyback on existing omega_state
 * augmentation. Returns structured confidence data.
 */
export function useCopilotState(dealId: string | null): CopilotState {
  const [loading, setLoading] = useState(true);
  const [confidence, setConfidence] = useState<CopilotConfidence>({
    available: false,
    confidence: null,
    recommendation: null,
    explanation: null,
  });
  const [omegaAvailable, setOmegaAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    if (!dealId) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch omega state from borrower debug endpoint (which has omega augmentation)
      const res = await fetch(`/api/deals/${dealId}/borrower/debug`);
      const data = await res.json();

      setCorrelationId(data?.meta?.correlationId ?? null);

      if (data?.omega_available && data?.omega_state) {
        const state = data.omega_state as Record<string, unknown>;
        setOmegaAvailable(true);
        setConfidence({
          available: true,
          confidence: typeof state.confidence === "number" ? state.confidence : null,
          recommendation: typeof state.recommendation === "string"
            ? (state.recommendation as CopilotConfidence["recommendation"])
            : null,
          explanation: typeof state.explanation === "string" ? state.explanation : null,
        });
      } else {
        setOmegaAvailable(false);
        setConfidence({
          available: false,
          confidence: null,
          recommendation: null,
          explanation: null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copilot state fetch failed");
      setOmegaAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  return {
    loading,
    confidence,
    omegaAvailable,
    error,
    correlationId,
    refresh: fetchState,
  };
}
