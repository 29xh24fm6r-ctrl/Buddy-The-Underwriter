"use client";

import { useEffect, useState } from "react";
import { ProcessingState, ErrorPanel } from "@/components/SafeBoundary";

type PipelineStage = "upload" | "ocr_queued" | "ocr_running" | "ocr_complete" | "auto_seeded" | "failed";
type PipelineStatus = "ok" | "pending" | "error";

interface PipelineState {
  stage: PipelineStage;
  status: PipelineStatus;
  payload?: any;
  error?: string;
  created_at: string;
}

/**
 * 🔥 PIPELINE STATUS WIDGET
 * 
 * Reads from canonical ledger and shows current state.
 * Prevents UI from rendering incomplete data.
 * 
 * Usage:
 * <PipelineStatus dealId={dealId}>
 *   {(state) => {
 *     if (state.stage === "ocr_running") return <ProcessingState label="Analyzing documents..." />;
 *     return <YourComponent />;
 *   }}
 * </PipelineStatus>
 */
export function PipelineStatus({
  dealId,
  children,
}: {
  dealId: string;
  children: (state: PipelineState | null) => React.ReactNode;
}) {
  const [state, setState] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchState() {
      try {
        const res = await fetch(`/api/deals/${dealId}/pipeline/latest`);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.state) {
            setState(data.state);
          }
        }
      } catch (err) {
        console.error("[PipelineStatus] fetch error:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchState();

    // Poll every 5 seconds when in pending states
    const interval = setInterval(() => {
      if (
        state?.status === "pending" ||
        state?.stage === "ocr_running" ||
        state?.stage === "ocr_queued"
      ) {
        fetchState();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [dealId, state?.status, state?.stage]);

  if (loading) {
    return <ProcessingState label="Loading pipeline status..." />;
  }

  return <>{children(state)}</>;
}

/**
 * 🔥 SIMPLE PIPELINE INDICATOR
 * 
 * Lightweight status badge for showing pipeline state.
 */
export function PipelineIndicator({ dealId }: { dealId: string }) {
  const [state, setState] = useState<PipelineState | null>(null);

  useEffect(() => {
    async function fetchState() {
      try {
        const res = await fetch(`/api/deals/${dealId}/pipeline/latest`);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.state) {
            setState(data.state);
          }
        }
      } catch (err) {
        console.error("[PipelineIndicator] fetch error:", err);
      }
    }

    fetchState();
  }, [dealId]);

  if (!state) return null;

  const isProcessing = state.stage === "ocr_running" || state.stage === "ocr_queued";
  const isError = state.status === "error";

  return (
    <div className="flex items-center gap-2 text-xs">
      {isProcessing && (
        <div className="flex items-center gap-1.5 text-blue-400">
          <div className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
          <span>Processing documents...</span>
        </div>
      )}
      {isError && (
        <div className="flex items-center gap-1.5 text-amber-400">
          <div className="h-2 w-2 rounded-full bg-amber-400" />
          <span>Pipeline error</span>
        </div>
      )}
      {state.stage === "auto_seeded" && state.status === "ok" && (
        <div className="flex items-center gap-1.5 text-green-400">
          <div className="h-2 w-2 rounded-full bg-green-400" />
          <span>Ready</span>
        </div>
      )}
    </div>
  );
}
