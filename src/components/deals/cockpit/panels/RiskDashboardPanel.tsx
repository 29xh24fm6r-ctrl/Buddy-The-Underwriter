"use client";

import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlagQuestion = {
  id: string;
  flag_id: string;
  question_text: string;
  question_context: string;
  document_requested: string | null;
  document_format: string | null;
  document_urgency: string;
  recipient_type: string;
  sent_at: string | null;
  answered_at: string | null;
};

type Flag = {
  id: string;
  deal_id: string;
  category: string;
  severity: string;
  trigger_type: string;
  observed_value: string | null;
  year_observed: number | null;
  banker_summary: string;
  banker_detail: string;
  banker_implication: string;
  has_borrower_question: boolean;
  status: string;
  banker_note: string | null;
  resolution_note: string | null;
  waived_reason: string | null;
  metadata?: Record<string, unknown> | null;
  question: FlagQuestion | null;
  created_at: string;
};

type FlagSummary = {
  critical: number;
  elevated: number;
  watch: number;
  informational: number;
  has_blocking: boolean;
  total: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, { bg: string; text: string; badge: string }> = {
  critical: { bg: "bg-red-900/30", text: "text-red-300", badge: "bg-red-700 text-red-100" },
  elevated: { bg: "bg-amber-900/30", text: "text-amber-300", badge: "bg-amber-700 text-amber-100" },
  watch: { bg: "bg-yellow-900/30", text: "text-yellow-300", badge: "bg-yellow-700 text-yellow-100" },
  informational: { bg: "bg-blue-900/30", text: "text-blue-300", badge: "bg-blue-700 text-blue-100" },
};

const CATEGORY_LABELS: Record<string, string> = {
  financial_irregularity: "Financial",
  missing_data: "Missing Document",
  policy_proximity: "Policy Proximity",
  qualitative_risk: "Qualitative Risk",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-zinc-600 text-zinc-200",
  banker_reviewed: "bg-blue-600 text-blue-100",
  sent_to_borrower: "bg-purple-600 text-purple-100",
  answered: "bg-teal-600 text-teal-100",
  resolved: "bg-green-700 text-green-100",
  waived: "bg-slate-600 text-slate-200",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  banker_reviewed: "Reviewed",
  sent_to_borrower: "Sent",
  answered: "Answered",
  resolved: "Resolved",
  waived: "Waived",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RiskDashboardPanel({ dealId }: { dealId: string }) {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [summary, setSummary] = useState<FlagSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [waiveInput, setWaiveInput] = useState<{ flagId: string; reason: string } | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);

  // Send dialog state
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sending, setSending] = useState(false);

  const fetchFlags = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/flags`);
      const data = await res.json();
      if (data.ok) {
        setFlags(data.flags);
        setSummary(data.summary);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const patchFlag = async (flagId: string, action: string, extra?: Record<string, string>) => {
    setMutating(flagId);
    try {
      const res = await fetch(`/api/deals/${dealId}/flags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag_id: flagId, action, ...extra }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchFlags();
      }
    } finally {
      setMutating(null);
      setWaiveInput(null);
    }
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/flags/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.ok) {
        setShowSendDialog(false);
        await fetchFlags();
      }
    } finally {
      setSending(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Count reviewed flags with questions (for send button visibility)
  const reviewedWithQuestion = flags.filter(
    (f) => f.status === "banker_reviewed" && f.question !== null,
  );

  if (loading) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="text-xs text-white/40 animate-pulse">Loading risk flags...</div>
      </div>
    );
  }

  if (!summary || summary.total === 0) {
    return (
      <div className="rounded-lg border border-green-800/40 bg-green-900/10 p-4">
        <div className="flex items-center gap-2">
          <span className="text-green-400 text-sm">&#10003;</span>
          <span className="text-sm text-green-300">No risk flags detected — spread analysis is clean</span>
        </div>
      </div>
    );
  }

  // Group flags by severity
  const activeFlags = flags.filter((f) => f.status !== "resolved" && f.status !== "waived");
  const resolvedFlags = flags.filter((f) => f.status === "resolved" || f.status === "waived");

  const groupBySeverity = (list: Flag[]) => {
    const groups: Record<string, Flag[]> = {};
    for (const f of list) {
      if (!groups[f.severity]) groups[f.severity] = [];
      groups[f.severity].push(f);
    }
    return groups;
  };

  const activeGroups = groupBySeverity(activeFlags);
  const severityOrder = ["critical", "elevated", "watch", "informational"];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-white/80">Risk Flags</h4>
          <div className="flex gap-1">
            {summary.critical > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-700 text-red-100">
                {summary.critical} critical
              </span>
            )}
            {summary.elevated > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-700 text-amber-100">
                {summary.elevated} elevated
              </span>
            )}
            {summary.watch > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-700 text-yellow-100">
                {summary.watch} watch
              </span>
            )}
          </div>
        </div>

        {reviewedWithQuestion.length > 0 && (
          <button
            onClick={() => setShowSendDialog(true)}
            className="text-[11px] px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            Send Questions to Borrower ({reviewedWithQuestion.length})
          </button>
        )}
      </div>

      {/* Blocking banner */}
      {summary.has_blocking && (
        <div className="rounded border border-red-700/50 bg-red-900/20 px-3 py-2 text-xs text-red-300">
          {summary.critical} critical flag{summary.critical !== 1 ? "s" : ""} must be resolved or
          waived before this deal can advance to credit committee
        </div>
      )}

      {/* Active flags grouped by severity */}
      {severityOrder.map((sev) => {
        const group = activeGroups[sev];
        if (!group || group.length === 0) return null;
        const colors = SEVERITY_COLORS[sev] ?? SEVERITY_COLORS.informational;
        return (
          <div key={sev} className="space-y-1.5">
            <div className={`text-[10px] uppercase tracking-wider font-semibold ${colors.text} px-1`}>
              {sev} ({group.length})
            </div>
            {group.map((flag) => (
              <FlagCard
                key={flag.id}
                flag={flag}
                expanded={expandedIds.has(flag.id)}
                onToggle={() => toggleExpand(flag.id)}
                onAction={(action, extra) => patchFlag(flag.id, action, extra)}
                mutating={mutating === flag.id}
                waiveInput={waiveInput?.flagId === flag.id ? waiveInput : null}
                onWaiveInputChange={(reason) =>
                  setWaiveInput({ flagId: flag.id, reason })
                }
                onWaiveCancel={() => setWaiveInput(null)}
              />
            ))}
          </div>
        );
      })}

      {/* Resolved/waived section */}
      {resolvedFlags.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-white/5">
          <div className="text-[10px] uppercase tracking-wider text-white/30 px-1">
            Resolved / Waived ({resolvedFlags.length})
          </div>
          {resolvedFlags.map((flag) => (
            <FlagCard
              key={flag.id}
              flag={flag}
              expanded={expandedIds.has(flag.id)}
              onToggle={() => toggleExpand(flag.id)}
              onAction={(action, extra) => patchFlag(flag.id, action, extra)}
              mutating={mutating === flag.id}
              waiveInput={null}
              onWaiveInputChange={() => {}}
              onWaiveCancel={() => {}}
            />
          ))}
        </div>
      )}

      {/* Send dialog */}
      {showSendDialog && (
        <SendDialog
          questions={reviewedWithQuestion}
          onConfirm={handleSend}
          onCancel={() => setShowSendDialog(false)}
          sending={sending}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FlagCard
// ---------------------------------------------------------------------------

function FlagCard({
  flag,
  expanded,
  onToggle,
  onAction,
  mutating,
  waiveInput,
  onWaiveInputChange,
  onWaiveCancel,
}: {
  flag: Flag;
  expanded: boolean;
  onToggle: () => void;
  onAction: (action: string, extra?: Record<string, string>) => void;
  mutating: boolean;
  waiveInput: { flagId: string; reason: string } | null;
  onWaiveInputChange: (reason: string) => void;
  onWaiveCancel: () => void;
}) {
  const colors = SEVERITY_COLORS[flag.severity] ?? SEVERITY_COLORS.informational;
  const isTerminal = flag.status === "resolved" || flag.status === "waived";

  return (
    <div
      className={`rounded border border-white/10 ${isTerminal ? "bg-white/[0.02] opacity-60" : "bg-white/5"} overflow-hidden`}
    >
      {/* Summary row */}
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2 flex items-start gap-2"
      >
        <span className="text-white/30 text-[10px] mt-0.5">{expanded ? "▾" : "▸"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-white/90 font-medium leading-tight">
              {flag.banker_summary}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`text-[9px] px-1 py-0.5 rounded ${colors.badge}`}>
              {flag.severity}
            </span>
            <span className="text-[9px] px-1 py-0.5 rounded bg-white/10 text-white/50">
              {CATEGORY_LABELS[flag.category] ?? flag.category}
            </span>
            <span className={`text-[9px] px-1 py-0.5 rounded ${STATUS_COLORS[flag.status] ?? ""}`}>
              {STATUS_LABELS[flag.status] ?? flag.status}
            </span>
            {flag.metadata?.source === "research_engine" && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-900/40 text-blue-300">
                Research
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-white/5">
          <div className="text-[11px] text-white/60 mt-2 leading-relaxed">
            {flag.banker_detail}
          </div>
          <div className="text-[11px] text-white/40 italic leading-relaxed">
            {flag.banker_implication}
          </div>

          {/* Question preview */}
          {flag.question && flag.status === "open" && (
            <div className="rounded bg-white/5 px-2 py-1.5 text-[11px] text-white/50">
              <span className="text-white/30 text-[9px] uppercase tracking-wider">Question: </span>
              {flag.question.question_text.length > 120
                ? flag.question.question_text.slice(0, 120) + "..."
                : flag.question.question_text}
            </div>
          )}

          {/* Resolution info */}
          {flag.resolution_note && (
            <div className="text-[10px] text-green-400/60">
              Resolution: {flag.resolution_note}
            </div>
          )}
          {flag.waived_reason && (
            <div className="text-[10px] text-slate-400">
              Waived: {flag.waived_reason}
            </div>
          )}

          {/* Actions */}
          {!isTerminal && (
            <div className="flex items-center gap-1.5 pt-1">
              {flag.status === "open" && (
                <button
                  disabled={mutating}
                  onClick={() => onAction("review")}
                  className="text-[10px] px-2 py-1 rounded bg-blue-600/80 hover:bg-blue-600 text-white disabled:opacity-40 transition-colors"
                >
                  Mark Reviewed
                </button>
              )}
              {flag.status === "banker_reviewed" && (
                <>
                  {waiveInput ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={waiveInput.reason}
                        onChange={(e) => onWaiveInputChange(e.target.value)}
                        placeholder="Waive reason..."
                        className="text-[10px] px-2 py-1 rounded bg-white/10 text-white border border-white/20 w-40"
                      />
                      <button
                        disabled={mutating || !waiveInput.reason.trim()}
                        onClick={() =>
                          onAction("waive", { waived_reason: waiveInput.reason.trim() })
                        }
                        className="text-[10px] px-2 py-1 rounded bg-slate-600 hover:bg-slate-500 text-white disabled:opacity-40"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={onWaiveCancel}
                        className="text-[10px] px-2 py-1 rounded bg-white/10 text-white/50 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      disabled={mutating}
                      onClick={() => onWaiveInputChange("")}
                      className="text-[10px] px-2 py-1 rounded bg-slate-600/80 hover:bg-slate-600 text-white disabled:opacity-40 transition-colors"
                    >
                      Waive
                    </button>
                  )}
                </>
              )}
              {(flag.status === "open" || flag.status === "banker_reviewed") && (
                <button
                  disabled={mutating}
                  onClick={() => onAction("resolve")}
                  className="text-[10px] px-2 py-1 rounded bg-green-700/80 hover:bg-green-700 text-white disabled:opacity-40 transition-colors"
                >
                  Resolve
                </button>
              )}
            </div>
          )}

          {/* Reopen action for terminal flags */}
          {isTerminal && (
            <button
              disabled={mutating}
              onClick={() => onAction("reopen")}
              className="text-[10px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/50 disabled:opacity-40 transition-colors"
            >
              Reopen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SendDialog
// ---------------------------------------------------------------------------

function SendDialog({
  questions,
  onConfirm,
  onCancel,
  sending,
}: {
  questions: Flag[];
  onConfirm: () => void;
  onCancel: () => void;
  sending: boolean;
}) {
  const docRequests = questions.filter((f) => f.question?.document_requested);
  const generalQuestions = questions.filter((f) => !f.question?.document_requested);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-white/10 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto">
        <div className="p-4 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white">Send Questions to Borrower</h3>
          <p className="text-[11px] text-white/40 mt-1">
            {questions.length} question{questions.length !== 1 ? "s" : ""} will be sent
            {docRequests.length > 0 && ` (${docRequests.length} document request${docRequests.length !== 1 ? "s" : ""})`}
          </p>
        </div>

        <div className="p-4 space-y-3">
          {/* General questions */}
          {generalQuestions.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">
                Questions ({generalQuestions.length})
              </div>
              {generalQuestions.map((f) => (
                <div key={f.id} className="text-[11px] text-white/60 bg-white/5 rounded px-2 py-1.5 mb-1">
                  {f.question?.question_text}
                </div>
              ))}
            </div>
          )}

          {/* Document requests */}
          {docRequests.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">
                Document Requests ({docRequests.length})
              </div>
              {docRequests.map((f) => (
                <div key={f.id} className="text-[11px] bg-white/5 rounded px-2 py-1.5 mb-1">
                  <div className="text-white/60">{f.question?.question_text}</div>
                  <div className="text-white/30 text-[10px] mt-0.5">
                    Document: {f.question?.document_requested}
                    {f.question?.document_format && ` (${f.question.document_format})`}
                    {" — "}
                    <span className="text-amber-400/60">{f.question?.document_urgency?.replace(/_/g, " ")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={sending}
            className="text-[11px] px-3 py-1.5 rounded bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={sending}
            className="text-[11px] px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 transition-colors"
          >
            {sending ? "Sending..." : "Confirm & Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
