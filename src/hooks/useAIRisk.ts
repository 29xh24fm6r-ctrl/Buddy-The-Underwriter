"use client";

import { useState, useEffect, useCallback } from "react";
import type { RiskOutput } from "@/lib/ai/provider";

export type AIRiskRun = RiskOutput & {
  id: string | null;
  createdAt: string | null;
};

export function useAIRisk(dealId: string) {
  const [run, setRun] = useState<AIRiskRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load latest persisted run on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/deals/${dealId}/ai-risk`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.ok && data.run) {
          // Flatten stored result: result_json holds the RiskOutput
          const stored = data.run;
          setRun({
            id: stored.id,
            createdAt: stored.created_at ?? stored.createdAt ?? null,
            ...(stored.result_json ?? stored),
          });
        }
      })
      .catch(() => {
        // No run yet — that's fine
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [dealId]);

  const runAssessment = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/ai-risk`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "AI risk run failed");
      setRun(data.run as AIRiskRun);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Unknown error");
    } finally {
      setRunning(false);
    }
  }, [dealId]);

  return { run, loading, running, error, runAssessment };
}
