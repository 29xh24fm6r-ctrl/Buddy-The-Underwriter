"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import {
  buildCockpitAdvisorSignals,
  type AdvisorConditionRow,
  type AdvisorMemoSummary,
  type AdvisorOverrideRow,
  type AdvisorTelemetryEvent,
  type CockpitAdvisorSignal,
} from "@/lib/journey/advisor/buildCockpitAdvisorSignals";
import { useCockpitAction } from "../../actions/useCockpitAction";
import type { CockpitAction } from "../../actions/actionTypes";

/**
 * SPEC-07 — deterministic cockpit advisor panel.
 *
 * Renders the rules-driven `buildCockpitAdvisorSignals` output. Stages
 * pass any data they already own (conditions, overrides, memo summary,
 * recent telemetry) so the advisor sees the freshest picture without
 * adding new fetches.
 */
export type CockpitAdvisorPanelProps = {
  dealId: string;
  conditions?: AdvisorConditionRow[];
  overrides?: AdvisorOverrideRow[];
  memoSummary?: AdvisorMemoSummary | null;
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

  const signals = useMemo<CockpitAdvisorSignal[]>(
    () =>
      buildCockpitAdvisorSignals({
        dealId,
        state: lifecycleState ?? null,
        conditions: props.conditions,
        overrides: props.overrides,
        memoSummary: props.memoSummary ?? null,
        recentTelemetry: props.recentTelemetry,
      }),
    [
      dealId,
      lifecycleState,
      props.conditions,
      props.overrides,
      props.memoSummary,
      props.recentTelemetry,
    ],
  );

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

  return (
    <li
      className={`rounded-lg border ${tone} px-3 py-2`}
      data-advisor-kind={signal.kind}
      data-advisor-severity={signal.severity}
      data-advisor-source={signal.source}
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
