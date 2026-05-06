/**
 * SPEC-08 — pure advisor memory summary.
 *
 * Folds recent cockpit telemetry into a compact "Recent activity" summary
 * for the advisor panel. Like the signal builder this is rules-driven and
 * fully testable — no fetch, no clock dependency beyond a caller-supplied
 * `now`.
 */
import type { AdvisorTelemetryEvent } from "./buildCockpitAdvisorSignals";

/**
 * SPEC-09 — deterministic behavior-pattern descriptors. The signal
 * builder turns each detected pattern into a `behavior_pattern_warning`.
 */
export type AdvisorBehaviorPattern =
  | {
      kind: "repeated_action_failure";
      actionType: string;
      count: number;
    }
  | {
      kind: "repeated_inline_undo";
      count: number;
    }
  | {
      kind: "stage_oscillation";
      stagesObserved: number;
      transitions: number;
    }
  | {
      kind: "stale_blocker";
      code: string;
      observedAt: string; // when the blocker was first seen
      stalenessMs: number;
    };

export type AdvisorMemorySummary = {
  lastActionAt?: string;
  lastActionLabel?: string;
  lastMutationAt?: string;
  lastMutationSummary?: string;
  lastUndoAt?: string;
  recentlyResolvedBlockers: number;
  recentFailures: number;
  /** SPEC-09 — detected patterns (deterministic, rules-driven). */
  patterns: AdvisorBehaviorPattern[];
};

export type AdvisorBlockerObservation = {
  code: string;
  /** When the blocker was first observed (ISO). */
  firstSeenAt: string;
};

/**
 * SPEC-09 — telemetry rows that include a `lifecycleStage` payload field
 * are read for stage_oscillation. Callers building telemetry from
 * /api/buddy/signals/latest already include this in their payloads.
 */
export type AdvisorTelemetryEventWithStage = AdvisorTelemetryEvent & {
  lifecycleStage?: string | null;
};

/**
 * SPEC-10 — named memory windows.
 *   "1h"  panel summary default
 *   "24h" pattern detection default
 *   "7d"  debug / "Why?" overlay
 */
export type AdvisorMemoryWindow = "1h" | "24h" | "7d";

export const ADVISOR_MEMORY_WINDOW_MS: Record<AdvisorMemoryWindow, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export type BuildAdvisorMemorySummaryInput = {
  recentTelemetry?: AdvisorTelemetryEvent[] | AdvisorTelemetryEventWithStage[];
  /** Explicit window in ms — wins over `window` when both are passed. */
  windowMs?: number;
  /** SPEC-10 — named convenience window. */
  window?: AdvisorMemoryWindow;
  /** Deterministic clock; defaults to Date.now(). */
  now?: number;
  /**
   * SPEC-09 — caller-provided list of currently-present blockers paired
   * with the timestamp the cockpit first saw them. Used for the
   * `stale_blocker` pattern. Pass an empty array (or omit) to skip the
   * stale-blocker detector.
   */
  blockerObservations?: AdvisorBlockerObservation[];
};

const DEFAULT_WINDOW_MS = ADVISOR_MEMORY_WINDOW_MS["1h"];
const STALE_BLOCKER_MS = 24 * 60 * 60 * 1000;

export function buildAdvisorMemorySummary(
  input: BuildAdvisorMemorySummaryInput,
): AdvisorMemorySummary {
  const events = input.recentTelemetry ?? [];
  const now = input.now ?? Date.now();
  const windowMs =
    input.windowMs ??
    (input.window ? ADVISOR_MEMORY_WINDOW_MS[input.window] : DEFAULT_WINDOW_MS);
  const cutoff = now - windowMs;

  // Sort newest first so "last X" finds the most recent matching event.
  const recent = events
    .filter((ev) => ev.ts >= cutoff)
    .slice()
    .sort((a, b) => b.ts - a.ts);

  let lastActionAt: string | undefined;
  let lastActionLabel: string | undefined;
  let lastMutationAt: string | undefined;
  let lastMutationSummary: string | undefined;
  let lastUndoAt: string | undefined;
  let recentlyResolvedBlockers = 0;
  let recentFailures = 0;

  for (const ev of recent) {
    const isAction =
      ev.type === "cockpit_action_succeeded" ||
      ev.type === "cockpit_action_failed";
    const isMutation =
      ev.type === "cockpit_inline_mutation_succeeded" ||
      ev.type === "cockpit_inline_mutation_failed";
    const isUndo = ev.type === "cockpit_inline_mutation_undone";
    const isBlockerFixOk = ev.type === "blocker_fix_succeeded";
    const isFailed = ev.type.endsWith("_failed");

    if (isAction && !lastActionAt) {
      lastActionAt = new Date(ev.ts).toISOString();
      lastActionLabel = ev.label ?? ev.type;
    }
    if (isMutation && !lastMutationAt) {
      lastMutationAt = new Date(ev.ts).toISOString();
      lastMutationSummary = ev.label ?? ev.type;
    }
    if (isUndo && !lastUndoAt) {
      lastUndoAt = new Date(ev.ts).toISOString();
    }
    if (isBlockerFixOk) recentlyResolvedBlockers += 1;
    if (isFailed) recentFailures += 1;
  }

  // ─── SPEC-09 pattern detection ────────────────────────────────────
  const patterns: AdvisorBehaviorPattern[] = [];

  // repeated_action_failure: same actionType failed >= 3 times in window.
  const failureCounts = new Map<string, number>();
  for (const ev of recent) {
    if (ev.type === "cockpit_action_failed" && ev.label) {
      failureCounts.set(ev.label, (failureCounts.get(ev.label) ?? 0) + 1);
    }
  }
  for (const [actionType, count] of failureCounts) {
    if (count >= 3) {
      patterns.push({
        kind: "repeated_action_failure",
        actionType,
        count,
      });
    }
  }

  // repeated_inline_undo: undone events >= 2 in window.
  const undoCount = recent.filter(
    (ev) => ev.type === "cockpit_inline_mutation_undone",
  ).length;
  if (undoCount >= 2) {
    patterns.push({ kind: "repeated_inline_undo", count: undoCount });
  }

  // stage_oscillation: distinct stages observed in lifecycleStage payloads
  // with >= 3 transitions.
  const stagesSeen: string[] = [];
  for (const ev of recent) {
    const stage = (ev as AdvisorTelemetryEventWithStage).lifecycleStage;
    if (typeof stage === "string" && stage) {
      // recent[] is sorted newest-first; reverse-traverse so we count
      // transitions in chronological order.
      stagesSeen.unshift(stage);
    }
  }
  let transitions = 0;
  for (let i = 1; i < stagesSeen.length; i++) {
    if (stagesSeen[i] !== stagesSeen[i - 1]) transitions += 1;
  }
  const stagesObserved = new Set(stagesSeen).size;
  if (transitions >= 3 && stagesObserved >= 2) {
    patterns.push({
      kind: "stage_oscillation",
      stagesObserved,
      transitions,
    });
  }

  // stale_blocker: requires opt-in observation list with first-seen
  // timestamps. We only emit when stalenessMs > 24h.
  for (const obs of input.blockerObservations ?? []) {
    const observedMs = Date.parse(obs.firstSeenAt);
    if (Number.isNaN(observedMs)) continue;
    const stalenessMs = now - observedMs;
    if (stalenessMs > STALE_BLOCKER_MS) {
      patterns.push({
        kind: "stale_blocker",
        code: obs.code,
        observedAt: obs.firstSeenAt,
        stalenessMs,
      });
    }
  }

  return {
    lastActionAt,
    lastActionLabel,
    lastMutationAt,
    lastMutationSummary,
    lastUndoAt,
    recentlyResolvedBlockers,
    recentFailures,
    patterns,
  };
}
