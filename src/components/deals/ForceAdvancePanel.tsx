"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { LifecycleStage } from "@/buddy/lifecycle/client";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

const FORCE_ADVANCE_ENABLED =
  process.env.NEXT_PUBLIC_LIFECYCLE_ALLOW_FORCE_ADVANCE === "1";

const MAX_STAGE =
  (process.env.NEXT_PUBLIC_LIFECYCLE_FORCE_ADVANCE_MAX_STAGE as LifecycleStage) ||
  "committee_ready";

// All lifecycle stages with display info
const ALL_STAGES = [
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

/** Linear stage order for cap filtering */
const STAGE_ORDER: LifecycleStage[] = [
  "intake_created", "docs_requested", "docs_in_progress", "docs_satisfied",
  "underwrite_ready", "underwrite_in_progress", "committee_ready",
  "committee_decisioned", "closing_in_progress", "closed",
];

function getAllowedStageValues(): Set<string> {
  const maxIdx = STAGE_ORDER.indexOf(MAX_STAGE);
  if (maxIdx === -1) return new Set(STAGE_ORDER.slice(0, 7));
  return new Set(STAGE_ORDER.slice(0, maxIdx + 1));
}

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

  if (!FORCE_ADVANCE_ENABLED) return null;

  const currentIndex = ALL_STAGES.findIndex((s) => s.value === currentStage);
  const allowedValues = getAllowedStageValues();
  const reasonValid = reason.trim().length >= 10;

  const handleForceAdvance = useCallback(async () => {
    if (!selectedStage || !reasonValid) return;

    setBusy(true);
    setResult(null);

    try {
      const res = await fetch(`/api/deals/${dealId}/lifecycle/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          force: true,
          targetStage: selectedStage,
          reason: reason.trim(),
        }),
      });

      const json = await res.json();

      if (json.ok) {
        setResult({
          type: "success",
          message: `Deal advanced to ${json.state?.stage || selectedStage}`,
        });
        setConfirmOpen(false);
        setSelectedStage("");
        setReason("");
        onAdvanced?.(json.state?.stage || selectedStage);
      } else {
        setResult({
          type: "error",
          message: json.message || json.error || "Force advance failed",
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
  }, [dealId, selectedStage, reason, reasonValid, onAdvanced]);

  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      <div className={glassHeader}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-400/70">Force Advance</span>
            <span className="text-[10px] text-red-400/50 font-mono">ADMIN</span>
          </div>
          <span
            className="text-white/40 text-sm transition-transform"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            &#9662;
          </span>
        </button>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Warning */}
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
            <div className="flex items-start gap-2">
              <div className="text-xs text-amber-200">
                <strong>Use with caution:</strong> Force advancing bypasses normal workflow checks.
                Capped at <span className="font-mono">{MAX_STAGE}</span>. All advances are audit-logged.
              </div>
            </div>
          </div>

          {/* Current Stage */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50">Current:</span>
            <span className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              ALL_STAGES.find((s) => s.value === currentStage)?.color || "bg-white/10 text-white/60"
            )}>
              {ALL_STAGES.find((s) => s.value === currentStage)?.label || currentStage || "Unknown"}
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
              {ALL_STAGES.filter((s) => allowedValues.has(s.value)).map((stage, index) => (
                <option
                  key={stage.value}
                  value={stage.value}
                  className="bg-neutral-900"
                  disabled={stage.value === currentStage}
                >
                  {stage.label} {stage.value === currentStage ? "(current)" : ""}
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
              className={cn(
                "w-full rounded-lg border bg-white/5 px-3 py-2 text-sm text-white outline-none min-h-[60px] resize-none",
                reasonValid ? "border-white/10 focus:border-white/20" : "border-red-500/30 focus:border-red-400/40"
              )}
              maxLength={500}
            />
            <div className="text-[10px] text-white/30 mt-1 text-right">
              {reason.trim().length}/500 (min 10 characters)
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
              disabled={!selectedStage || !reasonValid}
              className={cn(
                "w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
                !selectedStage || !reasonValid
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
                    {ALL_STAGES.find((s) => s.value === currentStage)?.label || currentStage}
                  </div>
                  <div>
                    <strong>To:</strong>{" "}
                    <span className="text-orange-300">
                      {ALL_STAGES.find((s) => s.value === selectedStage)?.label || selectedStage}
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
                  {busy ? "Advancing..." : "Confirm Force Advance"}
                </button>
              </div>
            </div>
          )}

          {/* Audit Note */}
          <div className="text-[10px] text-white/30 text-center">
            All force advances are logged in the audit ledger with your user ID, reason, and IP.
          </div>
        </div>
      )}
    </div>
  );
}
