"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types (mirrors server PipelineStep) ──────────────────────────────────

type PipelineStepStatus =
  | "complete"
  | "in_progress"
  | "pending"
  | "blocked"
  | "error";

type PipelineStep = {
  stepNumber: number;
  key: string;
  label: string;
  status: PipelineStepStatus;
  detail: string | null;
  blockerMessage: string | null;
  actionApi: string | null;
  actionLabel: string | null;
  actionMethod: "POST" | null;
  completedAt: string | null;
};

// ── Status styling ───────────────────────────────────────────────────────

const STATUS_STYLES: Record<PipelineStepStatus, {
  dot: string;
  line: string;
  label: string;
  bg: string;
  border: string;
}> = {
  complete: {
    dot: "bg-emerald-400",
    line: "bg-emerald-400/40",
    label: "text-emerald-300",
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/20",
  },
  in_progress: {
    dot: "bg-blue-400 animate-pulse",
    line: "bg-white/10",
    label: "text-blue-300",
    bg: "bg-blue-500/5",
    border: "border-blue-500/20",
  },
  pending: {
    dot: "bg-white/20",
    line: "bg-white/10",
    label: "text-white/40",
    bg: "bg-white/[0.02]",
    border: "border-white/10",
  },
  blocked: {
    dot: "bg-amber-400",
    line: "bg-white/10",
    label: "text-amber-300",
    bg: "bg-amber-500/5",
    border: "border-amber-500/20",
  },
  error: {
    dot: "bg-red-400",
    line: "bg-white/10",
    label: "text-red-300",
    bg: "bg-red-500/5",
    border: "border-red-500/20",
  },
};

const STATUS_ICONS: Record<PipelineStepStatus, string> = {
  complete: "✓",
  in_progress: "›",
  pending: "·",
  blocked: "!",
  error: "✕",
};

// ── Props ────────────────────────────────────────────────────────────────

interface Props {
  dealId: string;
  onMemoGenerated?: () => void;
}

// ── Component ────────────────────────────────────────────────────────────

export default function UnderwritingPipelineRail({ dealId, onMemoGenerated }: Props) {
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);

  const fetchPipeline = useCallback(async () => {
    try {
      const resp = await fetch(`/api/deals/${dealId}/underwrite/pipeline-state`);
      const data = await resp.json();
      if (data.ok && Array.isArray(data.steps)) {
        setSteps(data.steps);
      }
    } catch {
      // silent — degrade to empty rail
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

  const handleAction = async (step: PipelineStep) => {
    if (!step.actionApi || !step.actionMethod || runningAction) return;

    setRunningAction(step.key);
    try {
      await fetch(step.actionApi, { method: step.actionMethod });
      // If memo was generated, notify parent
      if (step.key === "memo" && onMemoGenerated) {
        onMemoGenerated();
      }
      // Refresh pipeline state
      await fetchPipeline();
    } catch {
      // silent
    } finally {
      setRunningAction(null);
    }
  };

  if (loading) {
    return <div className="animate-pulse h-32 bg-white/5 rounded-xl" />;
  }

  if (steps.length === 0) return null;

  const allComplete = steps.every((s) => s.status === "complete");

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
        Underwriting Pipeline
      </h3>

      {allComplete ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
            All pipeline steps complete — ready for committee
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="space-y-0">
            {steps.map((step, idx) => {
              const style = STATUS_STYLES[step.status];
              const isLast = idx === steps.length - 1;
              const isRunning = runningAction === step.key;
              const showAction =
                step.actionApi &&
                step.actionLabel &&
                step.status !== "blocked" &&
                step.status !== "in_progress";

              return (
                <div key={step.key} className="flex gap-3">
                  {/* Vertical timeline */}
                  <div className="flex flex-col items-center w-6 shrink-0">
                    {/* Step number circle */}
                    <div
                      className={`
                        flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold
                        ${step.status === "complete"
                          ? "bg-emerald-400/20 text-emerald-300"
                          : step.status === "in_progress"
                            ? "bg-blue-400/20 text-blue-300"
                            : step.status === "blocked"
                              ? "bg-amber-400/20 text-amber-300"
                              : step.status === "error"
                                ? "bg-red-400/20 text-red-300"
                                : "bg-white/10 text-white/30"
                        }
                      `}
                    >
                      {step.status === "complete"
                        ? STATUS_ICONS.complete
                        : step.stepNumber}
                    </div>
                    {/* Connector line */}
                    {!isLast && (
                      <div className={`w-px flex-1 min-h-[16px] ${style.line}`} />
                    )}
                  </div>

                  {/* Step content */}
                  <div className={`flex-1 pb-3 ${isLast ? "pb-0" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-sm font-medium ${style.label}`}>
                          {step.label}
                        </span>
                        {step.detail && (
                          <span className="text-xs text-white/30 truncate">
                            — {step.detail}
                          </span>
                        )}
                      </div>

                      {/* Action button */}
                      {showAction && (
                        <button
                          onClick={() => handleAction(step)}
                          disabled={isRunning}
                          className={`
                            shrink-0 rounded-md px-3 py-1 text-xs font-medium
                            transition-colors
                            ${isRunning
                              ? "bg-white/5 text-white/30 cursor-wait"
                              : "bg-white/10 text-white/70 hover:bg-white/15 hover:text-white"
                            }
                          `}
                        >
                          {isRunning ? "Running…" : step.actionLabel}
                        </button>
                      )}
                    </div>

                    {/* Blocker message */}
                    {step.blockerMessage && (
                      <div className="mt-1 text-xs text-amber-300/70">
                        {step.blockerMessage}
                      </div>
                    )}

                    {/* Completed timestamp */}
                    {step.completedAt && step.status === "complete" && (
                      <div className="mt-0.5 text-[10px] text-white/20">
                        {new Date(step.completedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
