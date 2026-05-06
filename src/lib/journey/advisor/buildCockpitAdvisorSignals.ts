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
import {
  buildAdvisorMemorySummary,
  ADVISOR_MEMORY_WINDOW_MS,
  type AdvisorBehaviorPattern,
  type AdvisorMemoryWindow,
} from "./buildAdvisorMemorySummary";
import type { AdvisorEvidence } from "./evidence";
import {
  buildDecisionQualitySignals,
  type DecisionQualityDecision,
  type DecisionQualityConditionRow,
  type DecisionQualityOverrideRow,
} from "./buildDecisionQualitySignals";

export type CockpitAdvisorSignalKind =
  | "next_best_action"
  | "blocked_reason"
  | "recent_change"
  | "readiness_warning"
  | "risk_warning"
  /** SPEC-09 — emitted by the pattern detectors in
   *  buildAdvisorMemorySummary. */
  | "behavior_pattern_warning"
  /** SPEC-11 — debug/admin-tier hint: a banker keeps dismissing or
   *  ignoring this advisor surface; lower its priority. */
  | "low_signal_value"
  /** SPEC-11 — deterministic forward-looking warning. */
  | "predictive_warning"
  /** SPEC-12 — decision-quality risks (approve-without-conditions,
   *  missing-rationale, memo-mismatch, attestation-gap). */
  | "decision_quality_warning"
  /** SPEC-12 — committee failure / delay risks. */
  | "committee_risk_warning"
  /** SPEC-12 — closing-stage delay risks. */
  | "closing_risk_warning"
  /** SPEC-12 — documentation-tier risks; reserved for future doc
   *  predictors. Currently surfaced via readiness_warning. */
  | "documentation_risk_warning";

export type CockpitAdvisorSignalSeverity = "info" | "warning" | "critical";

export type CockpitAdvisorSignalSource =
  | "lifecycle"
  | "blockers"
  | "conditions"
  | "overrides"
  | "memo"
  | "documents"
  | "telemetry"
  /** SPEC-12 — decision snapshot or attestation. */
  | "decision";

export type CockpitAdvisorSignal = {
  kind: CockpitAdvisorSignalKind;
  severity: CockpitAdvisorSignalSeverity;
  title: string;
  detail: string;
  action?: CockpitAction;
  source: CockpitAdvisorSignalSource;
  /**
   * SPEC-08 — deterministic priority. Higher numbers surface first.
   * See PRIORITY_BASE + severity/recency adjustments below.
   */
  priority: number;
  /** Human-readable explanation for the priority. */
  rankReason: string;
  /**
   * SPEC-08 — deterministic confidence in the signal's accuracy (0..1).
   * Lifecycle blockers are highest (0.95); telemetry-only inferences are
   * lowest (0.75); pure derived heuristics fall to 0.65.
   */
  confidence: number;
  /**
   * SPEC-11 — populated for predictive_warning signals. Cites the
   * deterministic rule that produced the prediction.
   *
   * SPEC-12 — also populated for committee/closing/decision_quality
   * warnings so the panel can render "Why this matters" without an
   * LLM round-trip.
   */
  predictionReason?: string;
  /**
   * SPEC-12 — deterministic evidence the signal was derived from.
   * Required for predictive / decision-quality / committee / closing
   * kinds. Empty/undefined for legacy SPEC-07–10 kinds.
   */
  evidence?: AdvisorEvidence[];
};

/**
 * SPEC-08 — priority floors per kind. Adjusted by severity / recency /
 * actionability inside the builder.
 *
 * SPEC-09 — `behavior_pattern_warning` slots between risk_warning and
 * readiness_warning so a 3rd repeated failure outranks "documents 80%".
 *
 * SPEC-11 — `predictive_warning` slots above generic recent_change but
 * below readiness/risk; severity bumps push critical predictives higher.
 * `low_signal_value` is intentionally floor-low; it's a debug/admin hint.
 */
const PRIORITY_FLOOR: Record<CockpitAdvisorSignalKind, number> = {
  blocked_reason: 800,             // critical surface — the deal cannot move
  decision_quality_warning: 700,   // SPEC-12 — above readiness, below blockers
  committee_risk_warning: 650,     // SPEC-12
  closing_risk_warning: 650,       // SPEC-12
  documentation_risk_warning: 620, // SPEC-12 (reserved)
  readiness_warning: 600,
  behavior_pattern_warning: 550,   // SPEC-09
  risk_warning: 500,
  predictive_warning: 450,         // SPEC-11
  next_best_action: 400,
  recent_change: 200,
  low_signal_value: 100,           // SPEC-11
};

/** Severity bumps. Stacks on the priority floor. */
const SEVERITY_BUMP: Record<CockpitAdvisorSignalSeverity, number> = {
  critical: 100,
  warning: 40,
  info: 0,
};

/** Confidence floors per source. */
const CONFIDENCE: Record<CockpitAdvisorSignalSource, number> = {
  blockers: 0.95,
  lifecycle: 0.9,
  documents: 0.9,
  decision: 0.9,
  conditions: 0.85,
  overrides: 0.85,
  memo: 0.85,
  telemetry: 0.75,
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
  /** SPEC-09 — lifecycle stage at the time of the event, when known. */
  lifecycleStage?: string | null;
};

/** SPEC-09 — caller-provided observation list used by stale_blocker. */
export type AdvisorBlockerObservationInput = {
  code: string;
  firstSeenAt: string;
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
  /**
   * SPEC-09 — opt-in observation list for the stale_blocker pattern
   * detector. Keyed by blocker code with the timestamp the cockpit first
   * saw the blocker.
   */
  blockerObservations?: AdvisorBlockerObservationInput[];
  /**
   * SPEC-10 — named pattern-detection window. Defaults to "24h".
   * Affects the memory summary internally consumed by the builder.
   */
  patternWindow?: AdvisorMemoryWindow;
  /**
   * SPEC-11 — caller-supplied dismiss-count map keyed by signal key.
   * Used by the `low_signal_value` detector. The panel passes this from
   * the server-persisted feedback rows; tests pass directly.
   */
  dismissCountsBySignalKey?: Record<string, number>;
  /**
   * SPEC-11 — caller-supplied acknowledged-without-action timestamps,
   * keyed by signal key. The detector emits low_signal_value if the
   * banker acknowledged the signal more than 24h ago and never cleared
   * it. Optional.
   */
  acknowledgedAtBySignalKey?: Record<string, string>;
  /**
   * SPEC-12 — current decision snapshot. Used by decision-quality
   * predictors (approval_without_conditions, attestation_gap, ...).
   * Optional; absent decisions skip the relevant checks.
   */
  decision?: DecisionQualityDecision | null;
  /**
   * SPEC-12 — recent failed `generate_packet` action timestamp (ms).
   * Used by committee_delay_risk predictor when caller has it; the
   * builder also derives it from `recentTelemetry` so most callers
   * don't need to pass this.
   */
  lastFailedPacketGenerationAt?: number | null;
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

  // SPEC-09/10 — emit behavior_pattern_warning signals for each detected
  // pattern. SPEC-10 default window for pattern detection is 24h (vs the
  // 1h panel-summary default). Caller can override via patternWindow.
  const memory = buildAdvisorMemorySummary({
    recentTelemetry: input.recentTelemetry,
    now: input.now,
    blockerObservations: input.blockerObservations,
    windowMs: ADVISOR_MEMORY_WINDOW_MS[input.patternWindow ?? "24h"],
  });
  for (const pattern of memory.patterns) {
    signals.push(buildPatternSignal(pattern, input.dealId));
  }

  // SPEC-11 — predictive_warning signals.
  for (const predictive of buildPredictiveWarnings(input)) {
    signals.push(predictive);
  }

  // SPEC-12 — committee + closing risk warnings.
  for (const sig of buildCommitteeRiskWarnings(input)) {
    signals.push(sig);
  }
  for (const sig of buildClosingRiskWarnings(input)) {
    signals.push(sig);
  }

  // SPEC-12 — decision-quality warnings.
  for (const dq of buildDecisionQualitySignals({
    state: input.state,
    decision: input.decision ?? null,
    conditions: input.conditions as DecisionQualityConditionRow[] | undefined,
    overrides: input.overrides as DecisionQualityOverrideRow[] | undefined,
    memoSummary: input.memoSummary ?? null,
    dealId: input.dealId,
  })) {
    signals.push(
      withRanking({
        kind: "decision_quality_warning",
        severity: dq.severity,
        title: dq.title,
        detail: dq.detail,
        action: dq.action,
        source: dq.source,
        rankReason: `Decision quality: ${dq.predictionReason}`,
        predictionReason: dq.predictionReason,
        evidence: dq.evidence,
      }),
    );
  }

  // SPEC-11 — low_signal_value hints (debug-tier).
  for (const low of buildLowSignalValueHints(input)) {
    signals.push(low);
  }

  // SPEC-08 — sort by priority desc; stable with respect to insertion order.
  return signals
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      if (b.s.priority !== a.s.priority) return b.s.priority - a.s.priority;
      return a.i - b.i;
    })
    .map((entry) => entry.s);
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
  const severity: CockpitAdvisorSignalSeverity = "info";
  return withRanking({
    kind: "next_best_action",
    severity,
    title: native.label,
    detail:
      native.description ??
      `Recommended next move while the deal is in ${stageLabel}.`,
    action,
    source: "lifecycle",
    rankReason: "Lifecycle recommends the next stage move",
  });
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
  // Infrastructure-class blockers (deal_not_found, schema_mismatch,
  // internal_error, *_fetch_failed) are critical — they break the deal's
  // ability to advance at all. Stage-gating blockers are warnings.
  const code = blocker.code;
  const isCritical =
    code === "deal_not_found" ||
    code === "schema_mismatch" ||
    code === "internal_error" ||
    code === "data_fetch_failed" ||
    code.endsWith("_fetch_failed");
  const severity: CockpitAdvisorSignalSeverity = isCritical
    ? "critical"
    : "warning";
  return withRanking({
    kind: "blocked_reason",
    severity,
    title: blocker.message,
    detail: `Blocker code: ${blocker.code}.`,
    action: fixAction ?? undefined,
    source: "blockers",
    rankReason: isCritical
      ? "Critical lifecycle blocker"
      : "Stage-gating blocker",
  });
}

function buildReadinessWarning(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal | null {
  if (!input.state) return null;
  const pct = input.state.derived.documentsReadinessPct ?? 0;
  if (pct >= READINESS_INFO_THRESHOLD_PCT) return null;

  const severity: CockpitAdvisorSignalSeverity =
    pct < READINESS_WARN_THRESHOLD_PCT ? "warning" : "info";

  return withRanking({
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
    rankReason: `Documents ${pct}% — ${severity}-grade readiness gap`,
  });
}

function buildRiskWarnings(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal[] {
  const out: CockpitAdvisorSignal[] = [];

  // Unresolved overrides (requires_review === true) → review needed.
  const reviewable =
    input.overrides?.filter((o) => o.requires_review === true) ?? [];
  if (reviewable.length > 0) {
    out.push(
      withRanking({
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
        rankReason: `${reviewable.length} unreviewed override${reviewable.length === 1 ? "" : "s"}`,
      }),
    );
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
    out.push(
      withRanking({
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
        rankReason: `${openRequired.length} open required condition${openRequired.length === 1 ? "" : "s"}`,
      }),
    );
  }

  // Memo gaps — required canonical facts missing.
  const memoMissing = input.memoSummary?.missing_keys?.length ?? 0;
  if (memoMissing > 0) {
    out.push(
      withRanking({
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
        rankReason: `${memoMissing} missing canonical memo fact${memoMissing === 1 ? "" : "s"}`,
      }),
    );
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

  const now = input.now ?? Date.now();
  return meaningful.map((ev) => {
    const failed = ev.type.endsWith("_failed");
    const ageMs = Math.max(0, now - ev.ts);
    return withRanking({
      kind: "recent_change",
      severity: failed ? "warning" : "info",
      title: TELEMETRY_LABEL[ev.type] ?? ev.type,
      detail: ev.label ?? "A recent cockpit action affected this deal.",
      source: "telemetry",
      rankReason: failed
        ? "Recent failed cockpit telemetry"
        : "Recent cockpit telemetry",
      // SPEC-08 V10: failed mutations bump priority well above generic
      // changes — they need banker attention now.
      _failed: failed,
      _ageMs: ageMs,
    });
  });
}

function stageLabelFor(stage: LifecycleStage | string): string {
  return STAGE_LABELS[stage as LifecycleStage] ?? String(stage);
}

// ─── SPEC-11 — deterministic predictive warnings ──────────────────

const STAGE_NEEDS_CONDITIONS: ReadonlySet<string> = new Set([
  "closing_in_progress",
  "closed",
]);

function buildPredictiveWarnings(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal[] {
  const out: CockpitAdvisorSignal[] = [];
  if (!input.state) return out;
  const derived = input.state.derived;

  // 1) likely_committee_delay
  // committee_required = true
  // AND committee_packet_ready = false
  // AND (memo gaps > 0 OR blockers > 0)
  const committeeRequired = derived.committeeRequired ?? false;
  const committeePacketReady = derived.committeePacketReady ?? false;
  const memoGaps = input.memoSummary?.missing_keys?.length ?? 0;
  const blockerCount = input.state.blockers.length;
  if (committeeRequired && !committeePacketReady && (memoGaps > 0 || blockerCount > 0)) {
    const evidence: AdvisorEvidence[] = [
      { source: "lifecycle", label: "Committee required", value: true },
      { source: "lifecycle", label: "Packet ready", value: false, severity: "warning" },
    ];
    if (memoGaps > 0) {
      evidence.push({ source: "memo", label: "Memo gaps", value: memoGaps, severity: "warning" });
    }
    if (blockerCount > 0) {
      evidence.push({ source: "blockers", label: "Open blockers", value: blockerCount, severity: "warning" });
    }
    out.push(
      withRanking({
        kind: "predictive_warning",
        severity: blockerCount >= 3 || memoGaps >= 5 ? "critical" : "warning",
        title: "Committee likely to be delayed",
        detail: `Packet not ready · ${memoGaps} memo gap${memoGaps === 1 ? "" : "s"} · ${blockerCount} blocker${blockerCount === 1 ? "" : "s"}.`,
        action: {
          intent: "navigate",
          label: "Committee Studio",
          href: `/deals/${input.dealId}/committee-studio`,
        },
        source: "lifecycle",
        rankReason: "Predictive: committee delay imminent",
        predictionReason: "likely_committee_delay",
        evidence,
      }),
    );
  }

  // 2) missing_required_condition
  // closing stage AND open critical/warning conditions exist.
  const stage = String(input.state.stage);
  if (STAGE_NEEDS_CONDITIONS.has(stage) && Array.isArray(input.conditions)) {
    const openCritical = input.conditions.filter((c) => {
      const sev = (c.severity ?? "").toUpperCase();
      const status = (c.status ?? "OPEN").toUpperCase();
      const isOpen = !["COMPLETE", "CLEARED", "SATISFIED", "WAIVED"].includes(
        status,
      );
      return isOpen && (sev === "REQUIRED" || sev === "CRITICAL" || sev === "IMPORTANT");
    });
    if (openCritical.length > 0) {
      out.push(
        withRanking({
          kind: "predictive_warning",
          severity: openCritical.length >= 3 ? "critical" : "warning",
          title: `${openCritical.length} required condition${openCritical.length === 1 ? "" : "s"} still open before close`,
          detail: "Closing cannot finalize until these clear.",
          action: {
            intent: "navigate",
            label: "Open Conditions",
            href: `/deals/${input.dealId}/conditions`,
          },
          source: "conditions",
          rankReason: "Predictive: closing blocked by open conditions",
          predictionReason: "missing_required_condition",
          evidence: [
            { source: "lifecycle", label: "Stage", value: stage },
            {
              source: "conditions",
              label: "Open required/critical conditions",
              value: openCritical.length,
              severity: openCritical.length >= 3 ? "critical" : "warning",
            },
          ],
        }),
      );
    }
  }

  // 3) high_risk_override_cluster
  // unresolved overrides >= 3 OR critical overrides >= 1.
  if (Array.isArray(input.overrides)) {
    const unresolved = input.overrides.filter(
      (o) => o.requires_review === true,
    );
    const critical = input.overrides.filter(
      (o) => (o.severity ?? "").toUpperCase() === "CRITICAL" || (o.severity ?? "").toUpperCase() === "HIGH",
    );
    if (unresolved.length >= 3 || critical.length >= 1) {
      const evidence: AdvisorEvidence[] = [];
      if (unresolved.length > 0) {
        evidence.push({
          source: "overrides",
          label: "Unresolved overrides",
          value: unresolved.length,
          severity: unresolved.length >= 3 ? "warning" : "info",
        });
      }
      if (critical.length > 0) {
        evidence.push({
          source: "overrides",
          label: "Critical overrides",
          value: critical.length,
          severity: "critical",
        });
      }
      out.push(
        withRanking({
          kind: "predictive_warning",
          severity: critical.length >= 1 ? "critical" : "warning",
          title:
            critical.length >= 1
              ? `${critical.length} critical override${critical.length === 1 ? "" : "s"} need review`
              : `${unresolved.length} unresolved overrides`,
          detail:
            critical.length >= 1
              ? "Critical overrides amplify decision risk."
              : "Cluster of overrides pending review may slow approval.",
          action: {
            intent: "navigate",
            label: "Decision Overrides",
            href: `/deals/${input.dealId}/decision/overrides`,
          },
          source: "overrides",
          rankReason: "Predictive: override cluster risk",
          predictionReason: "high_risk_override_cluster",
          evidence,
        }),
      );
    }
  }

  return out;
}

// ─── SPEC-12 — committee + closing risk warnings ──────────────────

const CLOSING_STAGES: ReadonlySet<string> = new Set([
  "closing_in_progress",
  "closed",
]);

function lastFailedPacketGenerationFromTelemetry(
  events: AdvisorTelemetryEvent[] | undefined,
): number | null {
  if (!events || events.length === 0) return null;
  let bestTs: number | null = null;
  for (const ev of events) {
    if (!ev.type.endsWith("_failed")) continue;
    const label = (ev.label ?? "").toLowerCase();
    if (label.includes("packet") || label.includes("memo")) {
      if (bestTs === null || ev.ts > bestTs) bestTs = ev.ts;
    }
  }
  return bestTs;
}

function buildCommitteeRiskWarnings(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal[] {
  const out: CockpitAdvisorSignal[] = [];
  if (!input.state) return out;
  const derived = input.state.derived;
  const committeeRequired = derived.committeeRequired ?? false;
  if (!committeeRequired) return out;

  const memoGaps = input.memoSummary?.missing_keys?.length ?? 0;
  const blockers = input.state.blockers;
  const blockerCount = blockers.length;
  const criticalBlockers = blockers.filter(
    (b) =>
      b.code === "deal_not_found" ||
      b.code === "schema_mismatch" ||
      b.code === "internal_error" ||
      b.code === "data_fetch_failed" ||
      b.code.endsWith("_fetch_failed"),
  );
  const overrides = input.overrides ?? [];
  const criticalOverrides = overrides.filter(
    (o) =>
      (o.severity ?? "").toUpperCase() === "CRITICAL" ||
      (o.severity ?? "").toUpperCase() === "HIGH",
  );
  const readinessPct = derived.documentsReadinessPct ?? 0;

  // 1) committee_failure_risk
  // committee required AND (
  //   critical overrides > 0
  //   OR memo gaps >= 3
  //   OR readiness < 80
  //   OR critical blockers exist
  // )
  const failureTriggers: AdvisorEvidence[] = [];
  if (criticalOverrides.length > 0) {
    failureTriggers.push({
      source: "overrides",
      label: "Critical overrides",
      value: criticalOverrides.length,
      severity: "critical",
    });
  }
  if (memoGaps >= 3) {
    failureTriggers.push({
      source: "memo",
      label: "Memo gaps",
      value: memoGaps,
      severity: "warning",
    });
  }
  if (readinessPct < 80) {
    failureTriggers.push({
      source: "documents",
      label: "Document readiness",
      value: `${readinessPct}%`,
      severity: "warning",
    });
  }
  if (criticalBlockers.length > 0) {
    failureTriggers.push({
      source: "blockers",
      label: "Critical blockers",
      value: criticalBlockers.length,
      severity: "critical",
    });
  }
  if (failureTriggers.length > 0) {
    out.push(
      withRanking({
        kind: "committee_risk_warning",
        severity:
          criticalOverrides.length > 0 || criticalBlockers.length > 0
            ? "critical"
            : "warning",
        title: "Committee likely to fail",
        detail: "One or more high-risk signals threaten committee approval.",
        action: {
          intent: "navigate",
          label: "Committee Studio",
          href: `/deals/${input.dealId}/committee-studio`,
        },
        source: "lifecycle",
        rankReason: "Predictive: committee failure risk",
        predictionReason: "committee_failure_risk",
        evidence: [
          { source: "lifecycle", label: "Committee required", value: true },
          ...failureTriggers,
        ],
      }),
    );
  }

  // 2) committee_delay_risk
  // committee required AND packet not ready
  // AND (memo gaps > 0 OR unresolved blockers > 0 OR recent failed packet action)
  const committeePacketReady = derived.committeePacketReady ?? false;
  const lastFailedPacketAt =
    input.lastFailedPacketGenerationAt ??
    lastFailedPacketGenerationFromTelemetry(input.recentTelemetry);
  if (
    !committeePacketReady &&
    (memoGaps > 0 || blockerCount > 0 || lastFailedPacketAt !== null)
  ) {
    const evidence: AdvisorEvidence[] = [
      { source: "lifecycle", label: "Committee required", value: true },
      { source: "lifecycle", label: "Packet ready", value: false, severity: "warning" },
    ];
    if (memoGaps > 0) {
      evidence.push({ source: "memo", label: "Memo gaps", value: memoGaps, severity: "warning" });
    }
    if (blockerCount > 0) {
      evidence.push({ source: "blockers", label: "Open blockers", value: blockerCount, severity: "warning" });
    }
    if (lastFailedPacketAt !== null) {
      evidence.push({
        source: "telemetry",
        label: "Recent failed packet/memo action",
        value: true,
        severity: "warning",
      });
    }
    out.push(
      withRanking({
        kind: "committee_risk_warning",
        severity: "warning",
        title: "Committee likely to be delayed",
        detail:
          "Packet generation has not completed and gating signals remain open.",
        action: {
          intent: "navigate",
          label: "Committee Studio",
          href: `/deals/${input.dealId}/committee-studio`,
        },
        source: "lifecycle",
        rankReason: "Predictive: committee delay risk",
        predictionReason: "committee_delay_risk",
        evidence,
      }),
    );
  }

  return out;
}

function buildClosingRiskWarnings(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal[] {
  const out: CockpitAdvisorSignal[] = [];
  if (!input.state) return out;
  const stage = String(input.state.stage);
  if (!CLOSING_STAGES.has(stage)) return out;

  const derived = input.state.derived;
  const docsReady = derived.documentsReady === true;
  const docReadinessPct = derived.documentsReadinessPct ?? 0;

  // closing_delay_risk:
  //   stage in closing
  //   AND (
  //     open warning/critical conditions > 0
  //     OR documentsReady = false
  //     OR documentsReadinessPct < 90
  //     OR unresolved financial exceptions > 0
  //   )
  const conds = input.conditions ?? [];
  const openCritical = conds.filter((c) => {
    const sev = (c.severity ?? "").toUpperCase();
    const status = (c.status ?? "OPEN").toUpperCase();
    const isOpen = !["COMPLETE", "CLEARED", "SATISFIED", "WAIVED"].includes(status);
    return isOpen && (sev === "REQUIRED" || sev === "CRITICAL" || sev === "WARNING" || sev === "IMPORTANT");
  });

  const triggers: AdvisorEvidence[] = [];
  if (openCritical.length > 0) {
    triggers.push({
      source: "conditions",
      label: "Open warning/critical conditions",
      value: openCritical.length,
      severity: openCritical.length >= 3 ? "critical" : "warning",
    });
  }
  if (!docsReady) {
    triggers.push({
      source: "documents",
      label: "Documents ready",
      value: false,
      severity: "warning",
    });
  } else if (docReadinessPct < 90) {
    triggers.push({
      source: "documents",
      label: "Document readiness",
      value: `${docReadinessPct}%`,
      severity: "warning",
    });
  }

  if (triggers.length === 0) return out;

  out.push(
    withRanking({
      kind: "closing_risk_warning",
      severity: openCritical.length >= 3 ? "critical" : "warning",
      title: "Closing likely to be delayed",
      detail: "Closing stage gating signals are still open.",
      action: {
        intent: "navigate",
        label: "Open Closing",
        href: `/deals/${input.dealId}/closing`,
      },
      source: "lifecycle",
      rankReason: "Predictive: closing delay risk",
      predictionReason: "closing_delay_risk",
      evidence: [{ source: "lifecycle", label: "Stage", value: stage }, ...triggers],
    }),
  );

  return out;
}

// ─── SPEC-11 — low_signal_value (debug/admin hint) ────────────────

const LOW_SIGNAL_DISMISS_THRESHOLD = 3;
const LOW_SIGNAL_ACK_AGE_MS = 24 * 60 * 60 * 1000;

function buildLowSignalValueHints(
  input: BuildCockpitAdvisorSignalsInput,
): CockpitAdvisorSignal[] {
  const out: CockpitAdvisorSignal[] = [];
  const now = input.now ?? Date.now();

  // Dismiss counter — if a signalKey has been dismissed >= 3 times,
  // emit a low_signal_value entry for the panel's debug surface.
  const counts = input.dismissCountsBySignalKey ?? {};
  for (const [key, count] of Object.entries(counts)) {
    if (count >= LOW_SIGNAL_DISMISS_THRESHOLD) {
      out.push(
        withRanking({
          kind: "low_signal_value",
          severity: "info",
          title: `Repeatedly dismissed: ${key}`,
          detail: `Dismissed ${count}× — consider tuning the rule that emits this.`,
          source: "telemetry",
          rankReason: "Repeated dismissals suggest low signal value",
        }),
      );
    }
  }

  // Acknowledged-but-stale — if a banker acknowledged a signal more than
  // 24h ago and the row still exists, treat the signal as low-value.
  const acks = input.acknowledgedAtBySignalKey ?? {};
  for (const [key, iso] of Object.entries(acks)) {
    const ackMs = Date.parse(iso);
    if (Number.isNaN(ackMs)) continue;
    if (now - ackMs > LOW_SIGNAL_ACK_AGE_MS) {
      out.push(
        withRanking({
          kind: "low_signal_value",
          severity: "info",
          title: `Acknowledged 24h+ ago: ${key}`,
          detail: "Acknowledgement is stale — signal likely no longer relevant.",
          source: "telemetry",
          rankReason: "Stale acknowledgement",
        }),
      );
    }
  }

  return out;
}

/**
 * SPEC-09 — turns a detected `AdvisorBehaviorPattern` into a
 * `behavior_pattern_warning` signal. Each pattern type has its own
 * messaging, severity floor, and rank-adjustment metadata.
 */
function buildPatternSignal(
  pattern: AdvisorBehaviorPattern,
  dealId: string,
): CockpitAdvisorSignal {
  let title = "Repeated workflow pattern";
  let detail = "A repeated banker workflow pattern was detected.";
  let severity: CockpitAdvisorSignalSeverity = "warning";
  let rankReason = "Behavior pattern detected";
  let action: CockpitAction | undefined;
  let _failed = false;
  let _undo = false;

  switch (pattern.kind) {
    case "repeated_action_failure":
      title = `${pattern.actionType} failed ${pattern.count}× recently`;
      detail =
        "The same cockpit action keeps failing. Check the endpoint or retry on a fresh refresh.";
      severity = pattern.count >= 5 ? "critical" : "warning";
      rankReason = `repeated ${pattern.actionType} failure (${pattern.count}×)`;
      _failed = true;
      break;
    case "repeated_inline_undo":
      title = `${pattern.count} inline edits undone recently`;
      detail =
        "The banker has reversed multiple inline edits. Worth pausing to reconcile state before continuing.";
      severity = "warning";
      rankReason = `${pattern.count} inline edits undone`;
      _undo = true;
      break;
    case "stage_oscillation":
      title = "Deal is oscillating between stages";
      detail = `Observed ${pattern.transitions} transitions across ${pattern.stagesObserved} stages.`;
      severity = pattern.transitions >= 5 ? "critical" : "warning";
      rankReason = `stage oscillation (${pattern.transitions} transitions)`;
      action = {
        intent: "navigate",
        label: "Lifecycle Status",
        href: `/deals/${dealId}/cockpit`,
      };
      break;
    case "stale_blocker":
      title = `Blocker open for >24h: ${pattern.code}`;
      detail = `The blocker has been present since ${pattern.observedAt}.`;
      severity = pattern.stalenessMs > 48 * 60 * 60 * 1000 ? "critical" : "warning";
      rankReason = `stale blocker ${pattern.code}`;
      break;
  }

  return withRanking({
    kind: "behavior_pattern_warning",
    severity,
    title,
    detail,
    action,
    source: "telemetry",
    rankReason,
    _failed,
    _undo,
  });
}

/**
 * SPEC-08 — fills in `priority`, `rankReason`, and `confidence` for a
 * partially-constructed signal. `priority` is computed from:
 *   - PRIORITY_FLOOR[kind]
 *   - SEVERITY_BUMP[severity]
 *   - actionability bump (signals carrying an action surface higher)
 *   - failed-mutation special case (recent_change of failure type
 *     gets a 250-point bump so it ranks above generic recent_change)
 *   - small recency adjustment (newer wins on the same kind)
 */
type SignalDraft = Omit<CockpitAdvisorSignal, "priority" | "rankReason" | "confidence"> & {
  rankReason: string;
  /** SPEC-11 — populated for predictive_warning signals; copied through. */
  predictionReason?: string;
  /** SPEC-12 — deterministic evidence rows; copied through. */
  evidence?: AdvisorEvidence[];
  /** internal — set true for failed recent_change / failure pattern events. */
  _failed?: boolean;
  /** internal — set true for undo-pattern events. */
  _undo?: boolean;
  /** internal — age in ms; used as a recency tie-breaker. */
  _ageMs?: number;
};

const ACTIONABLE_BUMP = 75;       // SPEC-09 widened from 25
const FAILED_RECENT_BUMP = 250;
const REPEATED_FAILURE_BUMP = 200;  // SPEC-09
const REPEATED_UNDO_BUMP = 150;     // SPEC-09
const RECENT_BUMP_UNDER_5MIN = 50;  // SPEC-09

function withRanking(draft: SignalDraft): CockpitAdvisorSignal {
  const floor = PRIORITY_FLOOR[draft.kind];
  const sevBump = SEVERITY_BUMP[draft.severity];
  const actionable = draft.action ? ACTIONABLE_BUMP : 0;

  // recent_change failures bump above generic recent_change.
  const failedRecentBump =
    draft.kind === "recent_change" && draft._failed ? FAILED_RECENT_BUMP : 0;

  // SPEC-09 — pattern bumps for behavior_pattern_warning signals.
  const repeatedFailureBump =
    draft.kind === "behavior_pattern_warning" && draft._failed
      ? REPEATED_FAILURE_BUMP
      : 0;
  const repeatedUndoBump =
    draft.kind === "behavior_pattern_warning" && draft._undo
      ? REPEATED_UNDO_BUMP
      : 0;

  // Recency bump: events under 5 minutes get a +50 boost on top of the
  // existing per-minute bump used for sort stability.
  const recentBump =
    typeof draft._ageMs === "number" && draft._ageMs < 5 * 60_000
      ? RECENT_BUMP_UNDER_5MIN
      : 0;
  const recencyBump =
    typeof draft._ageMs === "number"
      ? Math.max(0, 30 - Math.floor(draft._ageMs / 60_000))
      : 0;

  const priority =
    floor +
    sevBump +
    actionable +
    failedRecentBump +
    repeatedFailureBump +
    repeatedUndoBump +
    recentBump +
    recencyBump;

  const confidence = CONFIDENCE[draft.source] ?? 0.65;

  // Strip internal-only fields before returning.
  const { _failed, _undo, _ageMs, ...rest } = draft;
  void _failed;
  void _undo;
  void _ageMs;
  return { ...rest, priority, confidence };
}
