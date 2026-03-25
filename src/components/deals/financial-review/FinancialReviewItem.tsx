"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GapType = "missing_fact" | "low_confidence" | "conflict";

type Gap = {
  id: string;
  gap_type: GapType;
  fact_key: string;
  description: string;
  priority: number;
  fact_id: string | null;
  conflict_id: string | null;
};

type Provenance = {
  value: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  confidence: number | null;
  sourceDocumentName: string | null;
  sourceLineLabel: string | null;
  extractionPath: string | null;
};

type ResolveAction = "confirm_value" | "choose_source_value" | "override_value" | "provide_value" | "mark_follow_up";

type Props = {
  gap: Gap;
  provenance: Provenance | null;
  dealId: string;
  onResolved: () => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GAP_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  conflict:       { label: "Conflict",       color: "bg-orange-500/20 text-orange-300" },
  missing_fact:   { label: "Missing",        color: "bg-rose-500/20 text-rose-300" },
  low_confidence: { label: "Low confidence", color: "bg-amber-500/20 text-amber-300" },
};

const REASON_LABEL: Record<string, string> = {
  conflict:       "Buddy found conflicting values across source materials.",
  missing_fact:   "Buddy could not find this required metric in uploaded materials.",
  low_confidence: "Buddy extracted a value, but confidence is low and banker judgment is needed.",
};

const RATIONALE_PLACEHOLDER: Record<string, string> = {
  override_value: "Explain why the Buddy value is incorrect and why this replacement is appropriate.",
  provide_value:  "Explain where this value came from if it is not present in uploaded materials.",
  mark_follow_up: "Explain what is missing or what follow-up is required.",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPeriod(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) {
    const y1 = start.slice(0, 4);
    const y2 = end.slice(0, 4);
    return y1 === y2 ? `FY${y1}` : `${y1}\u2013${y2}`;
  }
  return start ? `FY${start.slice(0, 4)}` : `FY${end!.slice(0, 4)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FinancialReviewItem({ gap, provenance, dealId, onResolved }: Props) {
  const [expanded, setExpanded] = useState<ResolveAction | null>(null);
  const [rationale, setRationale] = useState("");
  const [overrideValue, setOverrideValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);

  const badge = GAP_TYPE_BADGE[gap.gap_type] ?? { label: gap.gap_type, color: "bg-white/10 text-white/50" };
  const prov = provenance;
  const period = prov ? formatPeriod(prov.periodStart, prov.periodEnd) : null;
  const reason = REASON_LABEL[gap.gap_type] ?? "Banker judgment needed.";

  async function submit(action: ResolveAction) {
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { gapId: gap.id, action };

      if (action === "confirm_value" || action === "choose_source_value") {
        body.factId = gap.fact_id;
      }
      if (action === "override_value" || action === "provide_value") {
        const num = parseFloat(overrideValue);
        if (isNaN(num)) { setError("Enter a valid number."); setSubmitting(false); return; }
        body.resolvedValue = num;
      }
      if (action === "override_value" || action === "provide_value" || action === "mark_follow_up") {
        body.rationale = rationale;
      }

      const res = await fetch(`/api/deals/${dealId}/financial-review/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (json.ok) {
        setResolved(json.resolution?.resolvedStatus ?? "resolved");
        setExpanded(null);
        onResolved();
      } else {
        const msg = json.errors?.[0]?.message ?? json.error ?? "Resolution failed.";
        setError(msg);
      }
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  // Already resolved in this session
  if (resolved) {
    const chipLabel: Record<string, string> = {
      resolved_confirmed: "Confirmed by banker",
      resolved_selected_source: "Source selected",
      resolved_overridden: "Overridden",
      resolved_provided: "Provided manually",
      deferred_follow_up: "Follow-up required",
    };
    return (
      <div className="px-4 py-3 flex items-center gap-2 opacity-60">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.color}`}>{badge.label}</span>
        <span className="text-xs font-mono text-white/40">{gap.fact_key}</span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 ml-auto">
          {chipLabel[resolved] ?? "Resolved"}
        </span>
      </div>
    );
  }

  // Determine available actions
  const actions: { key: ResolveAction; label: string; primary?: boolean }[] = [];
  if (gap.gap_type === "low_confidence") {
    actions.push({ key: "confirm_value", label: "Confirm value", primary: true });
    actions.push({ key: "override_value", label: "Override" });
    actions.push({ key: "mark_follow_up", label: "Follow up" });
  } else if (gap.gap_type === "conflict") {
    if (gap.fact_id) actions.push({ key: "choose_source_value", label: "Use this source", primary: true });
    actions.push({ key: "override_value", label: "Override" });
    actions.push({ key: "mark_follow_up", label: "Follow up" });
  } else if (gap.gap_type === "missing_fact") {
    actions.push({ key: "provide_value", label: "Provide value", primary: true });
    actions.push({ key: "mark_follow_up", label: "Follow up" });
  }

  const needsValueInput = expanded === "override_value" || expanded === "provide_value";
  const needsRationale = expanded === "override_value" || expanded === "provide_value" || expanded === "mark_follow_up";

  return (
    <div className="px-4 py-3">
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.color}`}>{badge.label}</span>
            <span className="text-xs font-mono text-white/40">{gap.fact_key}</span>
            {period && <span className="text-[10px] text-white/30">{period}</span>}
          </div>
          <p className="text-xs text-white/50 leading-relaxed">{gap.description}</p>
        </div>

        {/* Action buttons */}
        <div className="flex-shrink-0 flex items-center gap-1.5">
          {actions.map(a => (
            <button
              key={a.key}
              onClick={() => {
                if (a.key === "confirm_value" || a.key === "choose_source_value") {
                  submit(a.key);
                } else {
                  setExpanded(expanded === a.key ? null : a.key);
                  setError(null);
                }
              }}
              disabled={submitting}
              className={`text-[11px] font-semibold px-2 py-1 rounded transition-colors disabled:opacity-50 ${
                a.primary
                  ? "text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
                  : "text-white/50 border border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"
              }`}
            >
              {submitting && (a.key === "confirm_value" || a.key === "choose_source_value") ? "..." : a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Evidence block */}
      {prov && (
        <div className="mt-2 pl-3 border-l border-white/10 space-y-0.5">
          {prov.value != null && (
            <div className="text-[11px] text-white/40">
              <span className="text-white/25">Value:</span>{" "}
              <span className="text-white/60 font-medium">
                ${Number(prov.value).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>
            </div>
          )}
          {prov.sourceDocumentName && (
            <div className="text-[11px] text-white/40">
              <span className="text-white/25">Source:</span>{" "}
              <span className="text-white/50">{prov.sourceDocumentName}</span>
            </div>
          )}
          {prov.confidence != null && (
            <div className="text-[11px] text-white/40">
              <span className="text-white/25">Confidence:</span>{" "}
              <span className="text-white/50">{Math.round(prov.confidence * 100)}%</span>
            </div>
          )}
          <div className="text-[11px] text-white/30 italic">{reason}</div>
        </div>
      )}

      {gap.gap_type === "missing_fact" && !prov && (
        <div className="mt-1.5 text-[11px] text-white/30 italic">{reason}</div>
      )}

      {/* Expanded inline form */}
      {expanded && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
          {needsValueInput && (
            <div>
              <label className="block text-[11px] text-white/40 mb-1">
                {expanded === "override_value" ? "Override value" : "Value"}
              </label>
              <input
                type="number"
                value={overrideValue}
                onChange={e => setOverrideValue(e.target.value)}
                placeholder="e.g. 842127"
                className="w-full rounded border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
              />
            </div>
          )}
          {needsRationale && (
            <div>
              <label className="block text-[11px] text-white/40 mb-1">
                Rationale <span className="text-rose-400">*</span>
              </label>
              <textarea
                value={rationale}
                onChange={e => setRationale(e.target.value)}
                placeholder={RATIONALE_PLACEHOLDER[expanded] ?? "Explain your decision."}
                rows={2}
                className="w-full rounded border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
              />
            </div>
          )}
          {error && <div className="text-[11px] text-rose-400">{error}</div>}
          <div className="flex items-center gap-2">
            <button
              onClick={() => submit(expanded)}
              disabled={submitting}
              className="text-[11px] font-semibold text-white bg-white/10 hover:bg-white/15 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
            <button
              onClick={() => { setExpanded(null); setError(null); }}
              className="text-[11px] text-white/40 hover:text-white/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
