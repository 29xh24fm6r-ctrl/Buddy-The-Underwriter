"use client";

import { useState } from "react";

type ExceptionRecord = {
  id: string;
  exception_key: string;
  exception_type: string;
  severity: string;
  title: string;
  description: string;
  policy_reference?: string | null;
  detected_value?: number | null;
  policy_limit_value?: number | null;
  status: string;
  first_detected_at: string;
};

type ExceptionAction = {
  action_type: string;
  mitigant_text?: string | null;
  rationale_text?: string | null;
  acted_by?: string | null;
  acted_at: string;
  new_status?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  exception: ExceptionRecord | null;
  actions: ExceptionAction[];
  userRole?: string;
  onAddMitigant?: (exceptionId: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  onChangeStatus?: (exceptionId: string, status: string, rationale: string) => Promise<{ ok: boolean; error?: string }>;
};

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-amber-500/20 text-amber-300" },
  mitigated: { label: "Mitigated", cls: "bg-blue-500/20 text-blue-300" },
  waived: { label: "Waived", cls: "bg-purple-500/20 text-purple-300" },
  approved: { label: "Approved", cls: "bg-emerald-500/20 text-emerald-300" },
  rejected: { label: "Rejected", cls: "bg-rose-500/20 text-rose-300" },
  resolved: { label: "Resolved", cls: "bg-white/10 text-white/50" },
};

const APPROVER_ROLES = new Set(["super_admin", "bank_admin"]);

export function PolicyExceptionDrawer({ open, onClose, exception, actions, userRole, onAddMitigant, onChangeStatus }: Props) {
  const [mitigantText, setMitigantText] = useState("");
  const [rationaleText, setRationaleText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  if (!open || !exception) return null;

  const badge = STATUS_BADGES[exception.status] ?? STATUS_BADGES.open;
  const canApprove = APPROVER_ROLES.has(userRole ?? "");
  const isActive = exception.status !== "resolved" && exception.status !== "rejected";

  async function handleAddMitigant() {
    if (!onAddMitigant || !mitigantText.trim()) return;
    setSaving(true);
    setError(null);
    const result = await onAddMitigant(exception!.id, mitigantText.trim());
    setSaving(false);
    if (result.ok) {
      setMitigantText("");
    } else {
      setError(result.error ?? "Failed to add mitigant");
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!onChangeStatus) return;
    setPendingAction(newStatus);
    setError(null);
    const result = await onChangeStatus(exception!.id, newStatus, rationaleText.trim());
    setPendingAction(null);
    if (result.ok) {
      setRationaleText("");
    } else {
      setError(result.error ?? "Failed to update status");
    }
  }

  const mitigants = actions.filter((a) => a.action_type === "add_mitigant" && a.mitigant_text);
  const statusChanges = actions.filter((a) => a.action_type === "change_status");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-[min(92vw,520px)] h-full overflow-y-auto bg-[#0f1115] border-l border-white/10 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${exception.severity === "exception" ? "bg-rose-500/20 text-rose-300" : "bg-yellow-500/20 text-yellow-300"}`}>
                {exception.severity === "exception" ? "Exception" : "Warning"}
              </span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                {badge.label}
              </span>
            </div>
            <h2 className="text-base font-semibold text-white">{exception.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Facts */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
          <div className="text-xs font-semibold text-white/50">Policy Facts</div>
          <div className="text-sm text-white/80">{exception.description}</div>
          {exception.detected_value != null && (
            <div className="flex justify-between text-xs">
              <span className="text-white/50">Detected Value</span>
              <span className="text-white">{formatPolicyValue(exception.detected_value, exception.exception_type)}</span>
            </div>
          )}
          {exception.policy_limit_value != null && (
            <div className="flex justify-between text-xs">
              <span className="text-white/50">Policy Limit</span>
              <span className="text-white">{formatPolicyValue(exception.policy_limit_value, exception.exception_type)}</span>
            </div>
          )}
          {exception.policy_reference && (
            <div className="flex justify-between text-xs">
              <span className="text-white/50">Reference</span>
              <span className="text-white/70">{exception.policy_reference}</span>
            </div>
          )}
        </div>

        {/* Mitigants */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <div className="text-xs font-semibold text-white/50">Compensating Factors</div>
          {mitigants.length > 0 ? (
            <ul className="space-y-2">
              {mitigants.map((m, i) => (
                <li key={i} className="text-xs text-white/70 border-l-2 border-blue-500/30 pl-3">
                  {m.mitigant_text}
                  {m.acted_at && <div className="text-[10px] text-white/30 mt-0.5">{new Date(m.acted_at).toLocaleDateString()}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-white/40">No compensating factors documented yet.</div>
          )}

          {isActive && onAddMitigant && (
            <div className="space-y-2">
              <textarea
                value={mitigantText}
                onChange={(e) => setMitigantText(e.target.value)}
                placeholder="Document compensating factors (min 20 chars)..."
                className="w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/30 resize-none"
                rows={3}
              />
              <button
                type="button"
                onClick={handleAddMitigant}
                disabled={saving || mitigantText.trim().length < 20}
                className="rounded-lg bg-blue-600/20 border border-blue-500/30 px-3 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-600/30 disabled:opacity-40"
              >
                {saving ? "Saving..." : "Add Mitigant"}
              </button>
            </div>
          )}
        </div>

        {/* Workflow Actions */}
        {isActive && onChangeStatus && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <div className="text-xs font-semibold text-white/50">Workflow Actions</div>
            {(pendingAction === "waived" || pendingAction === "approved" || pendingAction === "rejected") && (
              <textarea
                value={rationaleText}
                onChange={(e) => setRationaleText(e.target.value)}
                placeholder="Rationale required (min 10 chars)..."
                className="w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/30 resize-none"
                rows={2}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleStatusChange("mitigated")}
                disabled={!!pendingAction}
                className="rounded-lg border border-blue-500/30 bg-blue-600/10 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-600/20 disabled:opacity-40"
              >
                Mark Mitigated
              </button>
              {canApprove && (
                <>
                  <button
                    type="button"
                    onClick={() => setPendingAction("approved")}
                    disabled={!!pendingAction && pendingAction !== "approved"}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-600/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-600/20 disabled:opacity-40"
                  >
                    {pendingAction === "approved" ? (
                      <span onClick={(e) => { e.stopPropagation(); handleStatusChange("approved"); }}>Confirm Approve</span>
                    ) : "Approve with Exception"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingAction("waived")}
                    disabled={!!pendingAction && pendingAction !== "waived"}
                    className="rounded-lg border border-purple-500/30 bg-purple-600/10 px-3 py-1.5 text-xs text-purple-200 hover:bg-purple-600/20 disabled:opacity-40"
                  >
                    {pendingAction === "waived" ? (
                      <span onClick={(e) => { e.stopPropagation(); handleStatusChange("waived"); }}>Confirm Waive</span>
                    ) : "Waive"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingAction("rejected")}
                    disabled={!!pendingAction && pendingAction !== "rejected"}
                    className="rounded-lg border border-rose-500/30 bg-rose-600/10 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-600/20 disabled:opacity-40"
                  >
                    {pendingAction === "rejected" ? (
                      <span onClick={(e) => { e.stopPropagation(); handleStatusChange("rejected"); }}>Confirm Reject</span>
                    ) : "Reject"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-rose-400 bg-rose-500/10 rounded-lg p-2">{error}</div>
        )}

        {/* Timeline */}
        {statusChanges.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
            <div className="text-xs font-semibold text-white/50">History</div>
            <ul className="space-y-1">
              {statusChanges.map((a, i) => (
                <li key={i} className="text-[11px] text-white/50">
                  <span className="text-white/70">{a.new_status}</span>
                  {a.rationale_text && <span> — {a.rationale_text}</span>}
                  <span className="text-white/30 ml-1">{new Date(a.acted_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function formatPolicyValue(value: number, type: string): string {
  if (type === "ltv_exceeded" || type === "equity_shortfall") {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toLocaleString();
}
