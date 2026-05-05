/**
 * SPEC-07 — pure cockpit advisor signal builder.
 *
 * Takes a snapshot of cockpit-derived inputs and emits a deterministic list
 * of advisory signals. No fetch, no I/O, no time-of-day branching beyond
 * what the caller supplies via `now`. Heavily tested.
 *
 * Future: this is the pure substrate for an LLM-augmented advisor; today
 * it's strictly rules-driven so the cockpit can ship with a trustworthy
 * floor of advice.
 */
import type {
  LifecycleBlocker,
  LifecycleStage,
  LifecycleState,
} from "@/buddy/lifecycle/model";
import { STAGE_LABELS } from "@/buddy/lifecycle/model";
import type { CockpitAction } from "@/components/journey/actions/actionTypes";
import { toCockpitAction } from "@/lib/journey/getNextAction";
import { toCockpitFixAction } from "@/lib/journey/getBlockerFixAction";
import { getNextAction as getLifecycleNextAction } from "@/buddy/lifecycle/nextAction";
import { getBlockerFixAction as getLifecycleBlockerFixAction } from "@/buddy/lifecycle/nextAction";

export type CockpitAdvisorSignalKind =
  | "next_best_action"
  | "blocked_reason"
  | "recent_change"
  | "readiness_warning"
  | "risk_warning";

export type CockpitAdvisorSignalSeverity = "info" | "warning" | "critical";

export type CockpitAdvisorSignalSource =
  | "lifecycle"
  | "blockers"
  | "conditions"
  | "overrides"
  | "memo"
  | "documents"
  | "telemetry";

export type CockpitAdvisorSignal = {
  kind: CockpitAdvisorSignalKind;
  severity: CockpitAdvisorSignalSeverity;
  title: string;
  detail: string;
  action?: CockpitAction;
  source: CockpitAdvisorSignalSource;
};

export type AdvisorConditionRow = {
  id: string;
  status?: string | null;
  severity?: string | null;
  title?: string | null;
};

export type AdvisorOverrideRow = {
  id: string;
  requires_review?: boolean;
  severity?: string | null;
};

export type AdvisorMemoSummary = {
  required_keys?: string[];
  present_keys?: string[];
  missing_keys?: string[];
};

export type AdvisorTelemetryEvent = {
  /** Telemetry kind, e.g. "cockpit_action_succeeded". */
  type: string;
  /** Epoch ms. */
  ts: number;
  /** Human-friendly label of the action / mutation, when available. */
  label?: string | null;
};

export type BuildCockpitAdvisorSignalsInput = {
  dealId: string;
  state: LifecycleState | null;
  conditions?: AdvisorConditionRow[];
  overrides?: AdvisorOverrideRow[];
  memoSummary?: AdvisorMemoSummary | null;
  /** Most recent telemetry events (may be empty / undefined). */
  recentTelemetry?: AdvisorTelemetryEvent[];
  /** Deterministic clock for "recent change" cutoff. Default: Date.now(). */
  now?: number;
};

const RECENT_TELEMETRY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const READINESS_WARN_THRESHOLD_PCT = 60; // < 60% docs ready → warn
const READINESS_INFO_THRESHOLD_PCT = 90; // < 90% → info

const TELEMETRY_LABEL: Record<string, string> = {
  cockpit_action_succeeded: "Action ran",
  cockpit_action_failed: "Action failed",
  blocker_fix_succeeded: "Blocker resolved",
  blocker_fix_failed: "Blocker fix failed",
  cockpit_inline_mutation_succeeded: "Inline edit saved",
  cockpit_inline_mutation_failed: "Inline edit failed",
  cockpit_inline_mutation_undone: "Inline edit undone",
  stage_data_refreshed: "Stage refreshed",
};

/** Pure entry point. */
export function buildCockpitAdvisorSignals(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal[] {
  const signals: CockpitAdvisorSignal[] = [];

  const nextBestAction = buildNextBestAction(input);
  if (nextBestAction) signals.push(nextBestAction);

  for (const blocked of buildBlockedReasons(input)) {
    signals.push(blocked);
  }

  const readiness = buildReadinessWarning(input);
  if (readiness) signals.push(readiness);

  for (const risk of buildRiskWarnings(input)) {
    signals.push(risk);
  }

  for (const change of buildRecentChanges(input)) {
    signals.push(change);
  }

  return signals;
}

function buildNextBestAction(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal | null {
  if (!input.state) return null;
  // Skip when blocked — the blocked_reason signal is the better next step.
  if (input.state.blockers.length > 0) return null;

  const native = getLifecycleNextAction(input.state, input.dealId);
  if (!native || native.intent === "complete") return null;
  const action = toCockpitAction(native);
  if (!action) return null;

  const stageLabel = stageLabelFor(input.state.stage);
  return {
    kind: "next_best_action",
    severity: "info",
    title: native.label,
    detail:
      native.description ??
      `Recommended next move while the deal is in ${stageLabel}.`,
    action,
    source: "lifecycle",
  };
}

function buildBlockedReasons(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal[] {
  if (!input.state) return [];
  const out: CockpitAdvisorSignal[] = [];
  for (const blocker of input.state.blockers) {
    out.push(blockedReasonForBlocker(blocker, input.dealId));
  }
  return out;
}

function blockedReasonForBlocker(
  blocker: LifecycleBlocker,
  dealId: string,
): CockpitAdvisorSignal {
  const fixNative = getLifecycleBlockerFixAction(blocker, dealId);
  const fixAction = toCockpitFixAction(fixNative, blocker.code);
  return {
    kind: "blocked_reason",
    severity: "warning",
    title: blocker.message,
    detail: `Blocker code: ${blocker.code}.`,
    action: fixAction ?? undefined,
    source: "blockers",
  };
}

function buildReadinessWarning(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal | null {
  if (!input.state) return null;
  const pct = input.state.derived.documentsReadinessPct ?? 0;
  if (pct >= READINESS_INFO_THRESHOLD_PCT) return null;

  const severity: CockpitAdvisorSignalSeverity =
    pct < READINESS_WARN_THRESHOLD_PCT ? "warning" : "info";

  return {
    kind: "readiness_warning",
    severity,
    title: `Document readiness ${pct}%`,
    detail:
      pct < READINESS_WARN_THRESHOLD_PCT
        ? "Required documents are still missing. Drive uploads and classification before underwriting."
        : "Most required documents are in. Close out the remainder before advancing.",
    action: {
      intent: "navigate",
      label: "Review Documents",
      href: `/deals/${input.dealId}/documents`,
    },
    source: "documents",
  };
}

function buildRiskWarnings(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal[] {
  const out: CockpitAdvisorSignal[] = [];

  // Unresolved overrides (requires_review === true) → review needed.
  const reviewable =
    input.overrides?.filter((o) => o.requires_review === true) ?? [];
  if (reviewable.length > 0) {
    out.push({
      kind: "risk_warning",
      severity: reviewable.length >= 3 ? "critical" : "warning",
      title: `${reviewable.length} override${reviewable.length === 1 ? "" : "s"} need review`,
      detail: "Overrides are open and pending banker review.",
      action: {
        intent: "navigate",
        label: "Open Decision Overrides",
        href: `/deals/${input.dealId}/decision/overrides`,
      },
      source: "overrides",
    });
  }

  // Open required conditions → critical risk if any are still open.
  const openRequired =
    input.conditions?.filter(
      (c) =>
        (c.severity ?? "").toUpperCase() === "REQUIRED" &&
        !["COMPLETE", "CLEARED", "SATISFIED", "WAIVED"].includes(
          (c.status ?? "OPEN").toUpperCase(),
        ),
    ) ?? [];
  if (openRequired.length > 0) {
    out.push({
      kind: "risk_warning",
      severity: openRequired.length >= 3 ? "critical" : "warning",
      title: `${openRequired.length} required condition${openRequired.length === 1 ? "" : "s"} still open`,
      detail: "Required conditions must clear before closing.",
      action: {
        intent: "navigate",
        label: "Open Conditions",
        href: `/deals/${input.dealId}/conditions`,
      },
      source: "conditions",
    });
  }

  // Memo gaps — required canonical facts missing.
  const memoMissing = input.memoSummary?.missing_keys?.length ?? 0;
  if (memoMissing > 0) {
    out.push({
      kind: "risk_warning",
      severity: memoMissing >= 5 ? "critical" : "warning",
      title: `${memoMissing} canonical memo fact${memoMissing === 1 ? "" : "s"} missing`,
      detail:
        "Memo cannot finalize until canonical facts are present. See reconciliation.",
      action: {
        intent: "navigate",
        label: "Open Memo",
        href: `/deals/${input.dealId}/credit-memo`,
      },
      source: "memo",
    });
  }

  return out;
}

function buildRecentChanges(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal[] {
  const events = input.recentTelemetry ?? [];
  if (events.length === 0) return [];
  const cutoff = (input.now ?? Date.now()) - RECENT_TELEMETRY_WINDOW_MS;

  // Pull the most recent meaningful event of each interesting type and
  // emit a single "recent_change" line. Stage refreshes are noise unless
  // they're the only signal.
  const meaningful: AdvisorTelemetryEvent[] = events
    .filter((ev) => ev.ts >= cutoff && ev.type !== "stage_data_refreshed")
    .slice(0, 3); // bound output

  if (meaningful.length === 0) return [];

  return meaningful.map((ev) => ({
    kind: "recent_change",
    severity:
      ev.type.endsWith("_failed") ? "warning" : "info",
    title: TELEMETRY_LABEL[ev.type] ?? ev.type,
    detail:
      ev.label ?? "A recent cockpit action affected this deal.",
    source: "telemetry",
  }));
}

function stageLabelFor(stage: LifecycleStage | string): string {
  return STAGE_LABELS[stage as LifecycleStage] ?? String(stage);
}
