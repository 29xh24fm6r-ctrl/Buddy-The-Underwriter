"use client";

import { useState, useCallback } from "react";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";

type ProcessResult = {
  ok: boolean;
  processed?: number;
  succeeded?: number;
  failed?: number;
  error?: string;
  message?: string;
};

export function useArtifactActions(dealId: string) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const { markUserAction, refresh } = useCockpitDataContext();

  const triggerRecognize = useCallback(async () => {
    setIsProcessing(true);
    setProcessResult(null);
    markUserAction();
    try {
      const res = await fetch(`/api/deals/${dealId}/artifacts/process`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const json: ProcessResult = await res.json();
      setProcessResult(json);
      await refresh();
    } catch (e: any) {
      setProcessResult({ ok: false, error: e?.message || "Network error" });
    } finally {
      setIsProcessing(false);
    }
  }, [dealId, markUserAction, refresh]);

  const triggerBackfill = useCallback(async () => {
    setIsProcessing(true);
    setProcessResult(null);
    markUserAction();
    try {
      const res = await fetch(`/api/deals/${dealId}/artifacts/backfill`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const json: ProcessResult = await res.json();
      setProcessResult(json);
      await refresh();
    } catch (e: any) {
      setProcessResult({ ok: false, error: e?.message || "Network error" });
    } finally {
      setIsProcessing(false);
    }
  }, [dealId, markUserAction, refresh]);

  const clearResult = useCallback(() => setProcessResult(null), []);

  return { isProcessing, processResult, triggerRecognize, triggerBackfill, clearResult };
}
