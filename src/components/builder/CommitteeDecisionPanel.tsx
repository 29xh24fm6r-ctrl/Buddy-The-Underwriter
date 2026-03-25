"use client";

import { useState } from "react";
import type { CommitteeDecisionType } from "@/lib/governance/committeeDecision";
import type { StructureStatusInfo } from "@/lib/governance/structureStatus";
import { StructureStatusBadge } from "./StructureStatusBadge";

type Props = {
  status: StructureStatusInfo;
  freezeId?: string | null;
  userRole?: string;
  onFreeze?: () => Promise<{ ok: boolean; error?: string }>;
  onDecision?: (decision: CommitteeDecisionType, notes: string) => Promise<{ ok: boolean; error?: string }>;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

const APPROVER_ROLES = new Set(["super_admin", "bank_admin"]);

const DECISION_OPTIONS: Array<{ value: CommitteeDecisionType; label: string; cls: string; notesRequired: boolean }> = [
  { value: "approved", label: "Approve", cls: "bg-emerald-600/20 border-emerald-500/30 text-emerald-200", notesRequired: false },
  { value: "approved_with_exceptions", label: "Approve with Exceptions", cls: "bg-amber-600/20 border-amber-500/30 text-amber-200", notesRequired: false },
  { value: "approved_with_changes", label: "Approve with Changes", cls: "bg-yellow-600/20 border-yellow-500/30 text-yellow-200", notesRequired: true },
  { value: "declined", label: "Decline", cls: "bg-rose-600/20 border-rose-500/30 text-rose-200", notesRequired: true },
];

export function CommitteeDecisionPanel({ status, freezeId, userRole, onFreeze, onDecision }: Props) {
  const [notes, setNotes] = useState("");
  const [pendingDecision, setPendingDecision] = useState<CommitteeDecisionType | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canApprove = APPROVER_ROLES.has(userRole ?? "");
  const canFreeze = APPROVER_ROLES.has(userRole ?? "") || userRole === "underwriter";
  const isFrozen = status.status === "frozen" || status.status.startsWith("approved") || status.status === "declined";
  const hasDecision = status.status.startsWith("approved") || status.status === "declined";

  async function handleFreeze() {
    if (!onFreeze) return;
    setSaving(true);
    setError(null);
    const result = await onFreeze();
    setSaving(false);
    if (!result.ok) setError(result.error ?? "Failed to freeze structure");
  }

  async function handleDecision(decision: CommitteeDecisionType) {
    if (!onDecision || !freezeId) return;
    const option = DECISION_OPTIONS.find((o) => o.value === decision);
    if (option?.notesRequired && notes.trim().length < 10) {
      setError("Notes required (min 10 characters) for this decision.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onDecision(decision, notes.trim());
    setSaving(false);
    if (result.ok) {
      setNotes("");
      setPendingDecision(null);
    } else {
      setError(result.error ?? "Failed to record decision");
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-white">Committee Governance</div>

      {/* Status */}
      <div className={glass}>
        <div className="flex items-center justify-between">
          <div className="text-xs text-white/50">Structure Status</div>
          <StructureStatusBadge status={status} />
        </div>
      </div>

      {/* Freeze action */}
      {status.status === "selected" && canFreeze && onFreeze && (
        <button
          type="button"
          onClick={handleFreeze}
          disabled={saving}
          className="w-full rounded-xl border border-purple-500/30 bg-purple-600/10 px-4 py-3 text-sm font-semibold text-purple-200 hover:bg-purple-600/20 disabled:opacity-40"
        >
          {saving ? "Freezing..." : "Freeze Structure for Committee"}
        </button>
      )}

      {/* Decision panel */}
      {isFrozen && !hasDecision && canApprove && onDecision && (
        <div className={`${glass} space-y-3`}>
          <div className="text-xs font-semibold text-white/50">Committee Decision</div>

          {/* Notes textarea */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Decision notes (required for changes/decline)..."
            className="w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/30 resize-none"
            rows={2}
          />

          {/* Decision buttons */}
          <div className="flex flex-wrap gap-2">
            {DECISION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  if (pendingDecision === opt.value) {
                    handleDecision(opt.value);
                  } else {
                    setPendingDecision(opt.value);
                  }
                }}
                disabled={saving}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold hover:brightness-110 disabled:opacity-40 ${opt.cls}`}
              >
                {pendingDecision === opt.value ? `Confirm ${opt.label}` : opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Previous decision display */}
      {hasDecision && (
        <div className={glass}>
          <div className="text-xs text-white/50 mb-1">Decision Recorded</div>
          <StructureStatusBadge status={status} />
        </div>
      )}

      {/* Non-authorized hint */}
      {isFrozen && !hasDecision && !canApprove && (
        <div className="text-xs text-white/40 text-center py-2">
          Committee decision requires Bank Admin or Credit Officer role.
        </div>
      )}

      {error && (
        <div className="text-xs text-rose-400 bg-rose-500/10 rounded-lg p-2">{error}</div>
      )}
    </div>
  );
}
