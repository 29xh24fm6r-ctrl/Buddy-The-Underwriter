"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AutoUnderwriteStatus, AutoUnderwriteStep } from "@/lib/orchestration/autoUnderwriteTypes";

const STEP_LABELS: Record<AutoUnderwriteStep, string> = {
  recompute_document_state: "Recomputing documents",
  extraction: "Extracting document data",
  financial_snapshot: "Generating financial spreads",
  model_engine_v2: "Running model engine",
  sba_package: "Computing SBA package",
  omega_advisory: "Computing advisory",
  credit_memo: "Building credit memo",
  narratives: "Generating narratives",
  voice_summary: "Synthesizing voice summary",
};

interface Props {
  dealId: string;
  onComplete?: () => void;
}

export default function AutoUnderwriteProgress({ dealId, onComplete }: Props) {
  const [status, setStatus] = useState<AutoUnderwriteStatus | null>(null);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(`/api/deals/${dealId}/auto-underwrite/status`);
      const data = await resp.json();
      if (data.ok) {
        setStatus(data);
        // Stop polling when complete or failed
        if (data.status === "complete" || data.status === "failed") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          if (data.status === "complete" && onComplete) {
            onComplete();
          }
        }
      }
    } catch {
      // silent
    } finally {
      setInitialCheckDone(true);
    }
  }, [dealId, onComplete]);

  useEffect(() => {
    fetchStatus();
    // Poll every 3 seconds while running
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  // Render null for idle/pre-Phase-68 deals
  if (!initialCheckDone) return null;
  if (!status || status.status === "idle") return null;

  const completedSteps = status.steps.filter((s) => s.status === "complete").length;
  const totalSteps = status.steps.filter((s) => s.status !== "skipped").length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  // Running
  if (status.status === "running") {
    const currentLabel = status.currentStep ? STEP_LABELS[status.currentStep] : "Processing";
    return (
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-blue-300">
              Buddy is underwriting this deal
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 rounded-full bg-blue-500/20 overflow-hidden">
                <div
                  className="h-full bg-blue-400 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-xs text-blue-300/70 shrink-0">
                Step {completedSteps + 1} of {totalSteps} — {currentLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Complete
  if (status.status === "complete") {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">&#x2713;</span>
            <span className="text-sm font-semibold text-emerald-300">
              Underwriting complete — Credit memo ready for review
            </span>
          </div>
          {status.memoReady && (
            <a
              href={`/deals/${dealId}/memo-template`}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              View Credit Memo →
            </a>
          )}
        </div>
      </div>
    );
  }

  // Failed
  if (status.status === "failed") {
    const failedStep = status.steps.find((s) => s.status === "failed");
    const stepLabel = failedStep ? STEP_LABELS[failedStep.step] : "Unknown step";
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-red-400">&#x26A0;</span>
              <span className="text-sm font-semibold text-red-300">
                Underwriting stopped at: {stepLabel}
              </span>
            </div>
            {failedStep?.error && (
              <p className="mt-1 text-xs text-red-200/60">
                Reason: {failedStep.error}
              </p>
            )}
          </div>
          <a
            href={`/deals/${dealId}/documents`}
            className="text-xs text-blue-400 hover:text-blue-300 shrink-0"
          >
            Review Documents →
          </a>
        </div>
      </div>
    );
  }

  return null;
}
