"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import {
  buildCockpitAdvisorSignals,
  type AdvisorBlockerObservationInput,
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
import {
  signalKey,
  useAdvisorSignalFeedback,
  type AdvisorSignalEffectiveState,
} from "./useAdvisorSignalFeedback";

/**
 * SPEC-07/08/09 — deterministic cockpit advisor panel.
 *
 * SPEC-09:
 *   - Grouped sections: Critical / Needs Attention / Suggested Actions /
 *     Recent Activity / Acknowledged.
 *   - Per-signal feedback: dismiss / snooze / acknowledge (localStorage).
 *   - `?advisor=debug` URL flag exposes priority / confidence / rankReason
 *     / source / signalKey / feedback state.
 *   - Optional `blockerObservations` prop feeds the stale_blocker pattern
 *     detector. Stage views (or a future hook) can supply it.
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
  /** SPEC-09 — opt-in for stale_blocker pattern detection. */
  blockerObservations?: AdvisorBlockerObservationInput[];
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
  behavior_pattern_warning: "Pattern",
};

type SignalGroup =
  | "critical"
  | "needs_attention"
  | "suggested"
  | "recent"
  | "acknowledged";

const GROUP_TITLE: Record<SignalGroup, string> = {
  critical: "Critical",
  needs_attention: "Needs Attention",
  suggested: "Suggested Actions",
  recent: "Recent Activity",
  acknowledged: "Acknowledged",
};

const ACK_PRIORITY_PENALTY = 150;
const SNOOZE_DURATION_MS = 60 * 60 * 1000; // 1 hour

export function CockpitAdvisorPanel(props: CockpitAdvisorPanelProps) {
  const { dealId } = props;
  const { lifecycleState } = useCockpitDataContext();
  const searchParams = useSearchParams();
  const debug = searchParams?.get("advisor") === "debug";

  // SPEC-08 live telemetry; caller-supplied events take precedence.
  const liveTelemetry = useRecentCockpitTelemetry(dealId, {
    enabled: !props.recentTelemetry,
  });
  const recentTelemetry = props.recentTelemetry ?? liveTelemetry.events;

  // SPEC-09 feedback (localStorage).
  const fb = useAdvisorSignalFeedback(dealId);

  const baseSignals = useMemo<CockpitAdvisorSignal[]>(
    () =>
      buildCockpitAdvisorSignals({
        dealId,
        state: lifecycleState ?? null,
        conditions: props.conditions,
        overrides: props.overrides,
        memoSummary: props.memoSummary ?? null,
        recentTelemetry,
        blockerObservations: props.blockerObservations,
      }),
    [
      dealId,
      lifecycleState,
      props.conditions,
      props.overrides,
      props.memoSummary,
      recentTelemetry,
      props.blockerObservations,
    ],
  );

  type Annotated = {
    signal: CockpitAdvisorSignal;
    effective: AdvisorSignalEffectiveState;
    group: SignalGroup;
  };

  const annotated: Annotated[] = useMemo(() => {
    const out: Annotated[] = [];
    for (const signal of baseSignals) {
      const eff = fb.effectiveStateFor(signal);
      if (eff.kind === "hidden_dismissed" || eff.kind === "hidden_snoozed") {
        continue;
      }
      const isAcknowledged = eff.kind === "acknowledged";
      const adjusted: CockpitAdvisorSignal = isAcknowledged
        ? {
            ...signal,
            priority: signal.priority - ACK_PRIORITY_PENALTY,
            rankReason: `${signal.rankReason} · acknowledged`,
          }
        : signal;
      out.push({
        signal: adjusted,
        effective: eff,
        group: classifySignal(adjusted, isAcknowledged),
      });
    }
    return out.sort((a, b) => b.signal.priority - a.signal.priority);
  }, [baseSignals, fb]);

  const groups: Record<SignalGroup, Annotated[]> = {
    critical: [],
    needs_attention: [],
    suggested: [],
    recent: [],
    acknowledged: [],
  };
  for (const ann of annotated) groups[ann.group].push(ann);

  const memory = useMemo<AdvisorMemorySummary>(
    () =>
      buildAdvisorMemorySummary({
        recentTelemetry,
        blockerObservations: props.blockerObservations,
      }),
    [recentTelemetry, props.blockerObservations],
  );

  const showMemory =
    Boolean(memory.lastActionAt) ||
    Boolean(memory.lastMutationAt) ||
    Boolean(memory.lastUndoAt) ||
    memory.recentlyResolvedBlockers > 0 ||
    memory.recentFailures > 0;

  const totalVisible = annotated.length;

  return (
    <section
      data-testid="cockpit-advisor-panel"
      data-advisor-debug={debug ? "true" : "false"}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-purple-300 text-[20px]">
          insights
        </span>
        <h3 className="text-sm font-semibold text-white">Cockpit Advisor</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-white/40">
          {debug ? "Debug" : "Deterministic"}
        </span>
      </header>

      {showMemory ? <AdvisorMemorySection memory={memory} /> : null}

      {totalVisible === 0 ? (
        <p className="text-xs text-white/50">
          No advisor signals right now — the cockpit is quiet.
        </p>
      ) : (
        <div className="space-y-3">
          {(
            ["critical", "needs_attention", "suggested", "recent", "acknowledged"] as SignalGroup[]
          ).map((group) => {
            const items = groups[group];
            if (items.length === 0) return null;
            return (
              <AdvisorGroupSection
                key={group}
                group={group}
                items={items}
                dealId={dealId}
                debug={debug}
                onAcknowledge={fb.acknowledge}
                onDismiss={fb.dismiss}
                onSnooze={(s) => fb.snooze(s, SNOOZE_DURATION_MS)}
                onClearFeedback={fb.clear}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function classifySignal(
  signal: CockpitAdvisorSignal,
  isAcknowledged: boolean,
): SignalGroup {
  if (isAcknowledged) return "acknowledged";
  if (signal.severity === "critical") return "critical";
  if (signal.kind === "next_best_action") return "suggested";
  if (signal.kind === "recent_change") return "recent";
  return "needs_attention";
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

function AdvisorGroupSection({
  group,
  items,
  dealId,
  debug,
  onAcknowledge,
  onDismiss,
  onSnooze,
  onClearFeedback,
}: {
  group: SignalGroup;
  items: {
    signal: CockpitAdvisorSignal;
    effective: AdvisorSignalEffectiveState;
  }[];
  dealId: string;
  debug: boolean;
  onAcknowledge: (s: CockpitAdvisorSignal) => void;
  onDismiss: (s: CockpitAdvisorSignal) => void;
  onSnooze: (s: CockpitAdvisorSignal) => void;
  onClearFeedback: (s: CockpitAdvisorSignal) => void;
}) {
  return (
    <div data-testid={`advisor-group-${group}`} data-advisor-group={group}>
      <div className="mb-1 flex items-baseline justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
          {GROUP_TITLE[group]}
        </h4>
        <span className="text-[10px] text-white/30">{items.length}</span>
      </div>
      <ul className="space-y-2">
        {items.map((entry, idx) => (
          <AdvisorSignalRow
            key={`${entry.signal.kind}:${entry.signal.source}:${entry.signal.title}:${idx}`}
            signal={entry.signal}
            dealId={dealId}
            isAcknowledged={group === "acknowledged"}
            debug={debug}
            onAcknowledge={onAcknowledge}
            onDismiss={onDismiss}
            onSnooze={onSnooze}
            onClearFeedback={onClearFeedback}
          />
        ))}
      </ul>
    </div>
  );
}

function AdvisorSignalRow({
  signal,
  dealId,
  isAcknowledged,
  debug,
  onAcknowledge,
  onDismiss,
  onSnooze,
  onClearFeedback,
}: {
  signal: CockpitAdvisorSignal;
  dealId: string;
  isAcknowledged: boolean;
  debug: boolean;
  onAcknowledge: (s: CockpitAdvisorSignal) => void;
  onDismiss: (s: CockpitAdvisorSignal) => void;
  onSnooze: (s: CockpitAdvisorSignal) => void;
  onClearFeedback: (s: CockpitAdvisorSignal) => void;
}) {
  const tone = SEVERITY_TONE[signal.severity];
  const badge = SEVERITY_BADGE[signal.severity];
  const kindLabel = KIND_LABEL[signal.kind];
  const confidencePct = Math.round(signal.confidence * 100);
  const key = signalKey(dealId, signal);

  return (
    <li
      className={`rounded-lg border ${tone} px-3 py-2 ${isAcknowledged ? "opacity-60" : ""}`}
      data-advisor-kind={signal.kind}
      data-advisor-severity={signal.severity}
      data-advisor-source={signal.source}
      data-advisor-priority={signal.priority}
      data-advisor-confidence={signal.confidence}
      data-advisor-signal-key={key}
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
          {debug ? (
            <div
              className="mt-1 rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[10px] text-white/60"
              data-testid="advisor-debug-block"
            >
              <div>priority: {signal.priority}</div>
              <div>confidence: {signal.confidence}</div>
              <div>rankReason: {signal.rankReason}</div>
              <div>source: {signal.source}</div>
              <div>signalKey: {key}</div>
              <div>feedback: {isAcknowledged ? "acknowledged" : "none"}</div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          {signal.action ? (
            <AdvisorActionButton action={signal.action} dealId={dealId} />
          ) : null}
          <div className="flex items-center gap-1">
            {!isAcknowledged ? (
              <FeedbackButton
                label="Ack"
                title="Acknowledge — keep visible but deemphasize"
                testId="advisor-ack"
                onClick={() => onAcknowledge(signal)}
              />
            ) : (
              <FeedbackButton
                label="Restore"
                title="Restore to active list"
                testId="advisor-clear"
                onClick={() => onClearFeedback(signal)}
              />
            )}
            <FeedbackButton
              label="Snooze"
              title="Hide for 1 hour"
              testId="advisor-snooze"
              onClick={() => onSnooze(signal)}
            />
            <FeedbackButton
              label="Dismiss"
              title="Hide until cleared"
              testId="advisor-dismiss"
              onClick={() => onDismiss(signal)}
            />
          </div>
        </div>
      </div>
    </li>
  );
}

function FeedbackButton({
  label,
  title,
  testId,
  onClick,
}: {
  label: string;
  title: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-testid={testId}
      className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60 hover:bg-white/10 hover:text-white/90"
    >
      {label}
    </button>
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
