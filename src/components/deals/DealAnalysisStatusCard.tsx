"use client";

/**
 * DealAnalysisStatusCard
 *
 * Single source of truth for "what's going on with this deal's analysis".
 * Consumes only `GET /api/deals/[dealId]/analysis-status` — never touches
 * raw analysis tables. The card always shows exactly one phase, one primary
 * action, the completion checklist, and (when present) the last successful
 * analysis pointers.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  DealAnalysisStatus,
  DealAnalysisPhase,
} from "@/lib/underwriting/getDealAnalysisStatus";

type Props = {
  dealId: string;
  /** Optional: render with a pre-fetched status (server-side / SSR). */
  initialStatus?: DealAnalysisStatus | null;
};

const PHASE_LABEL: Record<DealAnalysisPhase, string> = {
  not_started: "Not started",
  waiting_for_loan_request: "Waiting on loan request",
  waiting_for_documents: "Waiting on documents",
  waiting_for_spreads: "Waiting on spreads",
  running_analysis: "Analysis running",
  review_reconciliation: "Review reconciliation",
  ready_for_committee: "Ready for committee",
  analysis_failed: "Analysis failed",
};

const PHASE_TONE: Record<DealAnalysisPhase, string> = {
  not_started: "text-slate-300",
  waiting_for_loan_request: "text-amber-300",
  waiting_for_documents: "text-amber-300",
  waiting_for_spreads: "text-amber-300",
  running_analysis: "text-sky-300",
  review_reconciliation: "text-amber-300",
  ready_for_committee: "text-emerald-300",
  analysis_failed: "text-rose-300",
};

const SEVERITY_TONE = {
  error: "border-rose-500/40 bg-rose-500/10 text-rose-100",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-100",
} as const;

const CHECKLIST: Array<{ key: keyof DealAnalysisStatus["completed"]; label: string }> = [
  { key: "loanRequest", label: "Loan request" },
  { key: "documents", label: "Documents" },
  { key: "spreads", label: "Spreads ready" },
  { key: "modelSnapshot", label: "Model snapshot" },
  { key: "riskRun", label: "Risk run" },
  { key: "memo", label: "Credit memo" },
  { key: "decision", label: "System decision" },
  { key: "committeeReady", label: "Committee-ready" },
];

export default function DealAnalysisStatusCard({ dealId, initialStatus }: Props) {
  const [status, setStatus] = useState<DealAnalysisStatus | null>(initialStatus ?? null);
  const [loading, setLoading] = useState(!initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/analysis-status`, {
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(typeof json?.error === "string" ? json.error : "load_failed");
        setStatus(null);
      } else {
        setStatus(json.status as DealAnalysisStatus);
      }
    } catch {
      setError("load_failed");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    if (!initialStatus) {
      refresh();
    }
  }, [refresh, initialStatus]);

  const onPrimaryAction = useCallback(async () => {
    if (!status) return;
    const action = status.primaryAction;
    if (action.disabledReason) return;

    if (action.method === "POST") {
      setActionPending(true);
      try {
        const res = await fetch(`/api/deals/${dealId}/banker-analysis/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            reason: status.canForceReplay ? "admin_replay" : "manual_run",
            forceRun: status.canForceReplay,
          }),
        });
        await res.json().catch(() => null);
      } finally {
        setActionPending(false);
        refresh();
      }
      return;
    }

    if (action.href) {
      window.location.assign(action.href);
    }
  }, [dealId, status, refresh]);

  if (loading && !status) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
        <div className="h-4 w-1/3 animate-pulse rounded bg-slate-800" />
        <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-slate-800" />
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
        Couldn&apos;t load analysis status. {error ? <span className="opacity-70">({error})</span> : null}
        <div className="mt-3">
          <button
            type="button"
            onClick={refresh}
            className="rounded border border-rose-500/40 px-3 py-1 text-xs hover:bg-rose-500/20"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const phaseLabel = PHASE_LABEL[status.phase];
  const phaseTone = PHASE_TONE[status.phase];

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-slate-100">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Analysis status
          </div>
          <div className={`mt-0.5 text-lg font-semibold ${phaseTone}`}>
            {phaseLabel}
          </div>
        </div>
        {status.latest.updatedAt ? (
          <div className="text-xs text-slate-400">
            Updated {formatRelativeTime(status.latest.updatedAt)}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CHECKLIST.map((item) => (
          <ChecklistChip
            key={item.key}
            label={item.label}
            done={status.completed[item.key]}
          />
        ))}
      </div>

      {status.blockers.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {status.blockers.map((b) => (
            <li
              key={b.code}
              className={`rounded border px-3 py-2 text-sm ${SEVERITY_TONE[b.severity]}`}
            >
              <div className="font-medium">{b.title}</div>
              <div className="mt-0.5 text-xs opacity-90">{b.message}</div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onPrimaryAction}
          disabled={!!status.primaryAction.disabledReason || actionPending}
          className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
          title={status.primaryAction.disabledReason ?? undefined}
        >
          {actionPending ? "Working…" : status.primaryAction.label}
        </button>
        <button
          type="button"
          onClick={refresh}
          className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
        >
          Refresh
        </button>
      </div>

      {status.latestSuccessful.completedAt ? (
        <div className="mt-3 text-xs text-slate-400">
          Last successful analysis:{" "}
          {formatRelativeTime(status.latestSuccessful.completedAt)}
        </div>
      ) : null}
    </div>
  );
}

function ChecklistChip({ label, done }: { label: string; done: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
        done
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : "border-slate-700 bg-slate-900/60 text-slate-400"
      }`}
    >
      <span aria-hidden>{done ? "✓" : "·"}</span>
      <span>{label}</span>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const sec = Math.max(0, Math.round(diff / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
