/**
 * SPEC-08 — pure advisor memory summary.
 *
 * Folds recent cockpit telemetry into a compact "Recent activity" summary
 * for the advisor panel. Like the signal builder this is rules-driven and
 * fully testable — no fetch, no clock dependency beyond a caller-supplied
 * `now`.
 */
import type { AdvisorTelemetryEvent } from "./buildCockpitAdvisorSignals";

export type AdvisorMemorySummary = {
  lastActionAt?: string;
  lastActionLabel?: string;
  lastMutationAt?: string;
  lastMutationSummary?: string;
  lastUndoAt?: string;
  recentlyResolvedBlockers: number;
  recentFailures: number;
};

export type BuildAdvisorMemorySummaryInput = {
  recentTelemetry?: AdvisorTelemetryEvent[];
  /** Window in ms; defaults to 60 minutes. */
  windowMs?: number;
  /** Deterministic clock; defaults to Date.now(). */
  now?: number;
};

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

export function buildAdvisorMemorySummary(
  input: BuildAdvisorMemorySummaryInput,
): AdvisorMemorySummary {
  const events = input.recentTelemetry ?? [];
  const now = input.now ?? Date.now();
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
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

  return {
    lastActionAt,
    lastActionLabel,
    lastMutationAt,
    lastMutationSummary,
    lastUndoAt,
    recentlyResolvedBlockers,
    recentFailures,
  };
}
