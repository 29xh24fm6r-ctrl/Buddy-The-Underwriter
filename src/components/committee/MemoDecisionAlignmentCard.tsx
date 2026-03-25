"use client";

import type { MemoAlignmentState } from "@/lib/creditMemo/generateMemoFromFreeze";
import type { CreditMemoCompleteness } from "@/lib/creditMemo/computeCreditMemoCompleteness";
import type { DecisionReadiness } from "@/lib/decision/validateDecisionReadiness";

type Props = {
  structureStatus: string;
  memoStatus: string;
  memoAlignment: MemoAlignmentState;
  memoCompleteness: CreditMemoCompleteness;
  decisionReadiness: DecisionReadiness;
  activeExceptionCount: number;
  mitigatedExceptionCount: number;
  memoSnapshotTimestamp?: string | null;
  onGenerateMemo?: () => void;
  onReviewGaps?: () => void;
  onRecordDecision?: () => void;
  onFinalize?: () => void;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

const MEMO_STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Not Started", cls: "bg-white/10 text-white/50" },
  drafting: { label: "Drafting", cls: "bg-blue-500/20 text-blue-300" },
  needs_input: { label: "Needs Input", cls: "bg-amber-500/20 text-amber-300" },
  ready_for_committee: { label: "Ready for Committee", cls: "bg-emerald-500/20 text-emerald-300" },
  decision_recorded: { label: "Decision Recorded", cls: "bg-purple-500/20 text-purple-300" },
  finalized: { label: "Finalized", cls: "bg-emerald-500/20 text-emerald-300" },
};

const ALIGNMENT_STYLES: Record<MemoAlignmentState, { label: string; cls: string }> = {
  aligned: { label: "Aligned", cls: "text-emerald-300" },
  stale: { label: "Stale — needs refresh", cls: "text-amber-300" },
  missing: { label: "No memo generated", cls: "text-white/40" },
};

export function MemoDecisionAlignmentCard(props: Props) {
  const memoStyle = MEMO_STATUS_STYLES[props.memoStatus] ?? MEMO_STATUS_STYLES.not_started;
  const alignStyle = ALIGNMENT_STYLES[props.memoAlignment];

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-white">Memo & Decision Alignment</div>

      {/* Status grid */}
      <div className={`${glass} space-y-2`}>
        <div className="flex justify-between text-xs">
          <span className="text-white/50">Structure</span>
          <span className="text-white/70 capitalize">{props.structureStatus}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-white/50">Memo Status</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${memoStyle.cls}`}>
            {memoStyle.label}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-white/50">Memo Alignment</span>
          <span className={`text-xs ${alignStyle.cls}`}>{alignStyle.label}</span>
        </div>
        {props.memoSnapshotTimestamp && (
          <div className="flex justify-between text-xs">
            <span className="text-white/50">Memo Snapshot</span>
            <span className="text-white/30">{new Date(props.memoSnapshotTimestamp).toLocaleString()}</span>
          </div>
        )}
        <div className="flex justify-between text-xs">
          <span className="text-white/50">Memo Completeness</span>
          <span className={`text-xs ${props.memoCompleteness.complete ? "text-emerald-300" : "text-amber-300"}`}>
            {props.memoCompleteness.pct}%
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-white/50">Exceptions</span>
          <span className="text-white/70">
            {props.activeExceptionCount} active, {props.mitigatedExceptionCount} mitigated
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-white/50">Decision Readiness</span>
          <span className={`text-xs ${props.decisionReadiness.ready ? "text-emerald-300" : "text-rose-300"}`}>
            {props.decisionReadiness.ready ? "Ready" : "Not Ready"}
          </span>
        </div>
      </div>

      {/* Blockers */}
      {props.decisionReadiness.blockers.length > 0 && (
        <div className="rounded-xl border border-rose-500/15 bg-rose-600/5 p-3 space-y-1">
          <div className="text-[10px] font-semibold text-rose-300">Cannot record decision yet:</div>
          <ul className="space-y-0.5">
            {props.decisionReadiness.blockers.map((b, i) => (
              <li key={i} className="text-[10px] text-rose-300/80">&bull; {b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Missing memo sections */}
      {props.memoCompleteness.missing_sections.length > 0 && (
        <div className="rounded-xl border border-amber-500/15 bg-amber-600/5 p-3 space-y-1">
          <div className="text-[10px] font-semibold text-amber-300">Missing memo sections:</div>
          <ul className="space-y-0.5">
            {props.memoCompleteness.missing_sections.map((s, i) => (
              <li key={i} className="text-[10px] text-amber-300/80">&bull; {s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {(props.memoAlignment === "missing" || props.memoAlignment === "stale") && props.onGenerateMemo && (
          <button
            type="button"
            onClick={props.onGenerateMemo}
            className="rounded-lg border border-blue-500/30 bg-blue-600/10 px-3 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-600/20"
          >
            {props.memoAlignment === "stale" ? "Refresh Memo from Freeze" : "Generate Memo from Freeze"}
          </button>
        )}

        {props.memoCompleteness.missing_sections.length > 0 && props.onReviewGaps && (
          <button
            type="button"
            onClick={props.onReviewGaps}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
          >
            Review Memo Gaps
          </button>
        )}

        {props.decisionReadiness.ready && props.memoStatus !== "decision_recorded" && props.memoStatus !== "finalized" && props.onRecordDecision && (
          <button
            type="button"
            onClick={props.onRecordDecision}
            className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-600/30"
          >
            Record Decision
          </button>
        )}

        {props.memoStatus === "decision_recorded" && props.onFinalize && (
          <button
            type="button"
            onClick={props.onFinalize}
            className="rounded-lg bg-purple-600/20 border border-purple-500/30 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-600/30"
          >
            Finalize Decision Package
          </button>
        )}
      </div>
    </div>
  );
}
