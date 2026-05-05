"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import {
  buildCockpitAdvisorSignals,
  type AdvisorConditionRow,
  type AdvisorOverrideRow,
  type AdvisorTelemetryEvent,
  type CockpitAdvisorSignal,
} from "@/lib/journey/advisor/buildCockpitAdvisorSignals";
import {
  buildAdvisorMemorySummary,
  type AdvisorMemorySummary,
} from "@/lib/journey/advisor/buildAdvisorMemorySummary";
import { useCockpitAction } from "../../actions/useCockpitAction";
import type { CockpitAction } from "../../actions/actionTypes";
import { useRecentCockpitTelemetry } from "./useRecentCockpitTelemetry";

/**
 * SPEC-07/08 — deterministic cockpit advisor panel.
 *
 * SPEC-08:
 *   - Live telemetry pulled via useRecentCockpitTelemetry.
 *   - Signals ranked by priority (built into buildCockpitAdvisorSignals).
 *   - Compact "Recent activity" summary from buildAdvisorMemorySummary.
 *
 * Stages still pass the data they own (conditions, overrides, memo) so
 * the advisor sees the freshest picture without adding fetches.
 */
export type CockpitAdvisorPanelProps = {
  dealId: string;
  conditions?: AdvisorConditionRow[];
  overrides?: AdvisorOverrideRow[];
  memoSummary?:
    | {
        required_keys?: string[];
        present_keys?: string[];
        missing_keys?: string[];
      }
    | null;
  /**
   * Override the live telemetry feed with caller-supplied events. Used in
   * tests and for stages that already pull their own telemetry stream.
   */
  recentTelemetry?: AdvisorTelemetryEvent[];
};

const SEVERITY_TONE: Record<CockpitAdvisorSignal["severity"], string> = {
  info: "border-blue-500/30 bg-blue-500/5",
  warning: "border-amber-500/30 bg-amber-500/5",
  critical: "border-rose-500/30 bg-rose-500/5",
};

const SEVERITY_BADGE: Record<CockpitAdvisorSignal["severity"], string> = {
  info: "bg-blue-500/15 text-blue-200",
  warning: "bg-amber-500/15 text-amber-200",
  critical: "bg-rose-500/15 text-rose-200",
};

const KIND_LABEL: Record<CockpitAdvisorSignal["kind"], string> = {
  next_best_action: "Next move",
  blocked_reason: "Blocked",
  recent_change: "Recent",
  readiness_warning: "Readiness",
  risk_warning: "Risk",
};

export function CockpitAdvisorPanel(props: CockpitAdvisorPanelProps) {
  const { dealId } = props;
  const { lifecycleState } = useCockpitDataContext();

  // SPEC-08: live telemetry. Caller-supplied events take precedence (tests
  // / advanced surfaces that already manage their own feed).
  const liveTelemetry = useRecentCockpitTelemetry(dealId, {
    enabled: !props.recentTelemetry,
  });
  const recentTelemetry = props.recentTelemetry ?? liveTelemetry.events;

  const signals = useMemo<CockpitAdvisorSignal[]>(
    () =>
      buildCockpitAdvisorSignals({
        dealId,
        state: lifecycleState ?? null,
        conditions: props.conditions,
        overrides: props.overrides,
        memoSummary: props.memoSummary ?? null,
        recentTelemetry,
      }),
    [
      dealId,
      lifecycleState,
      props.conditions,
      props.overrides,
      props.memoSummary,
      recentTelemetry,
    ],
  );

  const memory = useMemo<AdvisorMemorySummary>(
    () => buildAdvisorMemorySummary({ recentTelemetry }),
    [recentTelemetry],
  );

  const showMemory =
    Boolean(memory.lastActionAt) ||
    Boolean(memory.lastMutationAt) ||
    Boolean(memory.lastUndoAt) ||
    memory.recentlyResolvedBlockers > 0 ||
    memory.recentFailures > 0;

  return (
    <section
      data-testid="cockpit-advisor-panel"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-purple-300 text-[20px]">
          insights
        </span>
        <h3 className="text-sm font-semibold text-white">Cockpit Advisor</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-white/40">
          Deterministic
        </span>
      </header>

      {showMemory ? (
        <AdvisorMemorySection memory={memory} />
      ) : null}

      {signals.length === 0 ? (
        <p className="text-xs text-white/50">
          No advisor signals right now — the cockpit is quiet.
        </p>
      ) : (
        <ul className="space-y-2">
          {signals.map((signal, idx) => (
            <AdvisorSignalRow
              key={`${signal.kind}:${signal.source}:${idx}`}
              signal={signal}
              dealId={dealId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AdvisorMemorySection({ memory }: { memory: AdvisorMemorySummary }) {
  const items: { label: string; detail: string; tone: string }[] = [];

  if (memory.lastActionAt && memory.lastActionLabel) {
    items.push({
      label: "Last action",
      detail: `${memory.lastActionLabel} · ${formatRelative(memory.lastActionAt)}`,
      tone: "text-blue-200",
    });
  }
  if (memory.lastMutationAt && memory.lastMutationSummary) {
    items.push({
      label: "Last edit",
      detail: `${memory.lastMutationSummary} · ${formatRelative(memory.lastMutationAt)}`,
      tone: "text-emerald-200",
    });
  }
  if (memory.lastUndoAt) {
    items.push({
      label: "Last undo",
      detail: formatRelative(memory.lastUndoAt),
      tone: "text-amber-200",
    });
  }
  if (memory.recentlyResolvedBlockers > 0) {
    items.push({
      label: "Resolved blockers",
      detail: `${memory.recentlyResolvedBlockers} in the last hour`,
      tone: "text-emerald-200",
    });
  }
  if (memory.recentFailures > 0) {
    items.push({
      label: "Recent failures",
      detail: `${memory.recentFailures} action${memory.recentFailures === 1 ? "" : "s"}`,
      tone: "text-rose-200",
    });
  }

  return (
    <div
      data-testid="cockpit-advisor-memory"
      className="mb-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
    >
      <div className="mb-1 text-[10px] uppercase tracking-wide text-white/50">
        Recent activity
      </div>
      <ul className="space-y-1">
        {items.map((it) => (
          <li
            key={it.label}
            className="flex items-baseline justify-between gap-2 text-[11px]"
          >
            <span className="text-white/50">{it.label}</span>
            <span className={`truncate ${it.tone}`}>{it.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdvisorSignalRow({
  signal,
  dealId,
}: {
  signal: CockpitAdvisorSignal;
  dealId: string;
}) {
  const tone = SEVERITY_TONE[signal.severity];
  const badge = SEVERITY_BADGE[signal.severity];
  const kindLabel = KIND_LABEL[signal.kind];
  const confidencePct = Math.round(signal.confidence * 100);

  return (
    <li
      className={`rounded-lg border ${tone} px-3 py-2`}
      data-advisor-kind={signal.kind}
      data-advisor-severity={signal.severity}
      data-advisor-source={signal.source}
      data-advisor-priority={signal.priority}
      data-advisor-confidence={signal.confidence}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badge}`}
            >
              {kindLabel}
            </span>
            <span className="truncate text-sm text-white">{signal.title}</span>
            <span
              className="ml-auto text-[10px] text-white/40"
              title={`Priority ${signal.priority} · ${signal.rankReason}`}
            >
              {confidencePct}%
            </span>
          </div>
          {signal.detail ? (
            <div className="mt-1 text-[11px] text-white/60">{signal.detail}</div>
          ) : null}
        </div>
        {signal.action ? (
          <AdvisorActionButton action={signal.action} dealId={dealId} />
        ) : null}
      </div>
    </li>
  );
}

function AdvisorActionButton({
  action,
  dealId,
}: {
  action: CockpitAction;
  dealId: string;
}) {
  const { state, run } = useCockpitAction(dealId);
  const id = `advisor:${action.intent}:${action.label}`;
  const isPending = state.status === "pending" && state.activeId === id;

  if (action.intent === "navigate") {
    return (
      <Link
        href={action.href}
        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/10"
        data-testid="advisor-action"
      >
        {action.label}
        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (isPending) return;
        void run(action, { id });
      }}
      disabled={isPending}
      aria-busy={isPending}
      className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[11px] font-semibold text-blue-100 hover:bg-blue-500/20 disabled:opacity-60"
      data-testid="advisor-action"
    >
      {isPending ? "Running…" : action.label}
      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
    </button>
  );
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  const delta = Date.now() - ts;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
