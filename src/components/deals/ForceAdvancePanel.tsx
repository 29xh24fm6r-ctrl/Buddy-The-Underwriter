"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

// All possible lifecycle stages
const STAGES = [
  { value: "intake_created", label: "Intake Created", color: "bg-slate-500/20 text-slate-300" },
  { value: "docs_requested", label: "Docs Requested", color: "bg-sky-500/20 text-sky-300" },
  { value: "docs_in_progress", label: "Docs In Progress", color: "bg-sky-500/20 text-sky-300" },
  { value: "docs_satisfied", label: "Docs Satisfied", color: "bg-blue-500/20 text-blue-300" },
  { value: "underwrite_ready", label: "Underwrite Ready", color: "bg-blue-500/20 text-blue-300" },
  { value: "underwrite_in_progress", label: "Underwriting", color: "bg-amber-500/20 text-amber-300" },
  { value: "committee_ready", label: "Committee Ready", color: "bg-purple-500/20 text-purple-300" },
  { value: "committee_decisioned", label: "Committee Decisioned", color: "bg-purple-500/20 text-purple-300" },
  { value: "closing_in_progress", label: "Closing", color: "bg-orange-500/20 text-orange-300" },
  { value: "closed", label: "Closed/Funded", color: "bg-emerald-500/20 text-emerald-300" },
  { value: "workout", label: "Workout", color: "bg-red-500/20 text-red-300" },
] as const;

type Props = {
  dealId: string;
  currentStage?: string | null;
  onAdvanced?: (newStage: string) => void;
};

export function ForceAdvancePanel({ dealId, currentStage, onAdvanced }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selectedStage, setSelectedStage] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const currentIndex = STAGES.findIndex((s) => s.value === currentStage);

  const handleForceAdvance = useCallback(async () => {
    if (!selectedStage || reason.length < 5) return;

    setBusy(true);
    setResult(null);

    try {
      const res = await fetch(`/api/deals/${dealId}/lifecycle/force-advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetStage: selectedStage,
          reason,
          skipBlockers: true,
        }),
      });

      const json = await res.json();

      if (json.ok) {
        setResult({
          type: "success",
          message: `Deal advanced to ${json.toStage || selectedStage}`,
        });
        setConfirmOpen(false);
        setSelectedStage("");
        setReason("");
        onAdvanced?.(json.toStage || selectedStage);
      } else {
        setResult({
          type: "error",
          message: json.error || json.message || "Force advance failed",
        });
      }
    } catch (e: any) {
      setResult({
        type: "error",
        message: e?.message || "Network error",
      });
    } finally {
      setBusy(false);
    }
  }, [dealId, selectedStage, reason, onAdvanced]);

  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      <div className={glassHeader}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-orange-400 text-[18px]">fast_forward</span>
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">Manual Advance</span>
          </div>
          <span
            className="material-symbols-outlined text-white/40 text-[16px] transition-transform"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            expand_more
          </span>
        </button>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Warning */}
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-amber-400 text-[16px] mt-0.5">warning</span>
              <div className="text-xs text-amber-200">
                <strong>Use with caution:</strong> Force advancing bypasses normal workflow checks. 
                All advances are logged for audit purposes.
              </div>
            </div>
          </div>

          {/* Current Stage */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50">Current:</span>
            <span className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              STAGES.find((s) => s.value === currentStage)?.color || "bg-white/10 text-white/60"
            )}>
              {STAGES.find((s) => s.value === currentStage)?.label || currentStage || "Unknown"}
            </span>
          </div>

          {/* Stage Selector */}
          <div>
            <label className="block text-xs text-white/50 mb-1.5">Advance to:</label>
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
            >
              <option value="" className="bg-neutral-900">Select stage...</option>
              {STAGES.map((stage, index) => (
                <option
                  key={stage.value}
                  value={stage.value}
                  className="bg-neutral-900"
                  disabled={index === currentIndex}
                >
                  {stage.label} {index < currentIndex ? "(backward)" : index === currentIndex ? "(current)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Reason Input */}
          <div>
            <label className="block text-xs text-white/50 mb-1.5">
              Reason for override <span className="text-red-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Borrower provided docs in person, fast-tracking for commitment deadline..."
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20 min-h-[60px] resize-none"
              maxLength={500}
            />
            <div className="text-[10px] text-white/30 mt-1 text-right">
              {reason.length}/500 (min 5 characters)
            </div>
          </div>

          {/* Result Message */}
          {result && (
            <div className={cn(
              "rounded-lg px-3 py-2 text-xs",
              result.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-200"
                : "bg-red-500/10 border border-red-500/20 text-red-200"
            )}>
              {result.message}
            </div>
          )}

          {/* Action Buttons */}
          {!confirmOpen ? (
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={!selectedStage || reason.length < 5}
              className={cn(
                "w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
                !selectedStage || reason.length < 5
                  ? "bg-white/5 text-white/30 cursor-not-allowed"
                  : "bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-400 hover:to-amber-400"
              )}
            >
              Preview Force Advance
            </button>
          ) : (
            <div className="space-y-3">
              {/* Confirmation */}
              <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 p-3">
                <div className="text-xs text-orange-200 font-semibold mb-2">Confirm Force Advance</div>
                <div className="text-xs text-white/60 space-y-1">
                  <div>
                    <strong>From:</strong>{" "}
                    {STAGES.find((s) => s.value === currentStage)?.label || currentStage}
                  </div>
                  <div>
                    <strong>To:</strong>{" "}
                    <span className="text-orange-300">
                      {STAGES.find((s) => s.value === selectedStage)?.label || selectedStage}
                    </span>
                  </div>
                  <div className="text-white/40 mt-2">
                    <strong>Reason:</strong> {reason}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmOpen(false)}
                  disabled={busy}
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleForceAdvance}
                  disabled={busy}
                  className={cn(
                    "flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
                    busy
                      ? "bg-orange-500/50 text-white/50 animate-pulse"
                      : "bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-400 hover:to-red-400"
                  )}
                >
                  {busy ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                      Advancing...
                    </span>
                  ) : (
                    "Confirm Force Advance"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Audit Note */}
          <div className="text-[10px] text-white/30 text-center">
            <span className="material-symbols-outlined text-[10px] align-middle mr-1">history</span>
            All force advances are logged in the audit ledger with your user ID and reason.
          </div>
        </div>
      )}
    </div>
  );
}
