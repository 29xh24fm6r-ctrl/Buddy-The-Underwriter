"use client";

import { useEffect, useState } from "react";
import { ProcessingState, ErrorPanel } from "@/components/SafeBoundary";
import { usePipelineState } from "@/lib/pipeline/usePipelineState";

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
  const { pipeline } = usePipelineState(dealId);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mark as loaded once we have any pipeline data
    if (pipeline.lastUpdatedAt !== null) {
      setLoading(false);
    }
  }, [pipeline.lastUpdatedAt]);

  // Build legacy state shape for backwards compatibility
  const state: PipelineState | null = pipeline.lastMessage
    ? {
        stage: (pipeline.meta?.stage as PipelineStage) ?? "upload",
        status: (pipeline.meta?.status as PipelineStatus) ?? "ok",
        payload: pipeline.meta,
        error: pipeline.meta?.error as string | undefined,
        created_at: pipeline.lastUpdatedAt ?? new Date().toISOString(),
      }
    : null;

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
  const { pipeline } = usePipelineState(dealId);

  if (!pipeline.lastMessage) return null;

  const isProcessing = pipeline.isWorking;
  const isError = !!(pipeline.uiState === "waiting" && pipeline.meta?.error);

  return (
    <div className="flex items-center gap-2 text-xs">
      {isProcessing && (
        <div className="flex items-center gap-1.5 text-blue-400">
          <div className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
          <span>{pipeline.lastMessage}</span>
        </div>
      )}
      {isError && (
        <div className="flex items-center gap-1.5 text-amber-400">
          <div className="h-2 w-2 rounded-full bg-amber-400" />
          <span>Pipeline error</span>
        </div>
      )}
      {pipeline.uiState === "done" && !isError && (
        <div className="flex items-center gap-1.5 text-green-400">
          <div className="h-2 w-2 rounded-full bg-green-400" />
          <span>Ready</span>
        </div>
      )}
    </div>
  );
}
