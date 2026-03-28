"use client";

/**
 * Phase 65J — Review Case Panel
 */

type CaseInfo = {
  id: string;
  status: string;
  readinessState: string;
  dueAt: string;
  borrowerCampaignId: string | null;
  pendingRequirementCount: number;
  openExceptionCount: number;
  label: string;
};

type Props = {
  cases: CaseInfo[];
  onStartReview: (caseType: string, caseId: string) => void;
  onComplete: (caseType: string, caseId: string) => void;
  loading: boolean;
};

const READINESS_STYLES: Record<string, string> = {
  ready: "text-emerald-400",
  missing_borrower_items: "text-amber-400",
  missing_banker_review: "text-blue-400",
  exception_open: "text-red-400",
  not_started: "text-white/40",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ReviewCasePanel({ cases, onStartReview, onComplete, loading }: Props) {
  if (cases.length === 0) {
    return <div className="text-center text-white/30 py-6 text-sm">No active review or renewal cases.</div>;
  }

  return (
    <div className="space-y-3">
      {cases.map((c) => (
        <div key={c.id} className="glass-card rounded-xl p-4 flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white/90">{c.label}</span>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-white/5 border border-white/10 text-white/50">
                {c.status.replace(/_/g, " ")}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-white/50">
              <span>Due: {formatDate(c.dueAt)}</span>
              <span className={READINESS_STYLES[c.readinessState] ?? "text-white/40"}>
                {c.readinessState.replace(/_/g, " ")}
              </span>
              {c.pendingRequirementCount > 0 && (
                <span className="text-amber-400">{c.pendingRequirementCount} pending</span>
              )}
              {c.openExceptionCount > 0 && (
                <span className="text-red-400">{c.openExceptionCount} exception{c.openExceptionCount > 1 ? "s" : ""}</span>
              )}
            </div>
          </div>
          <div className="flex gap-1.5">
            {(c.status === "collecting" || c.status === "requesting") && (
              <button onClick={() => onStartReview(c.id, c.id)} disabled={loading}
                className="px-3 py-1 text-xs rounded bg-blue-600/80 text-white hover:bg-blue-500 transition disabled:opacity-50">
                Start Review
              </button>
            )}
            {c.readinessState === "ready" && c.status !== "completed" && c.status !== "decision_pending" && (
              <button onClick={() => onComplete(c.id, c.id)} disabled={loading}
                className="px-3 py-1 text-xs rounded bg-emerald-600/80 text-white hover:bg-emerald-500 transition disabled:opacity-50">
                Complete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
