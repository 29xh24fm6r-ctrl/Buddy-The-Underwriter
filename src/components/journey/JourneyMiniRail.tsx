"use client";

import type { LifecycleStage } from "@/buddy/lifecycle/model";
import { STAGE_LABELS } from "@/buddy/lifecycle/model";

const LINEAR_STAGES: LifecycleStage[] = [
  "intake_created",
  "docs_requested",
  "docs_in_progress",
  "docs_satisfied",
  "underwrite_ready",
  "underwrite_in_progress",
  "committee_ready",
  "committee_decisioned",
  "closing_in_progress",
  "closed",
];

const CANONICAL_KEYS = new Set<string>([
  ...LINEAR_STAGES,
  "workout",
]);

/**
 * Map legacy `deals.stage` strings to canonical lifecycle stages.
 * Returns null when the stage cannot be mapped (renders unknown state).
 */
export function legacyStageToCanonical(s: string | null): LifecycleStage | null {
  if (!s) return null;
  const lower = s.toLowerCase();

  if (CANONICAL_KEYS.has(lower)) return lower as LifecycleStage;

  if (lower === "collecting") return "docs_in_progress";
  if (lower === "underwriting") return "underwrite_in_progress";
  if (lower === "intake") return "intake_created";
  if (lower === "created") return "intake_created";
  if (lower === "closing") return "closing_in_progress";
  if (lower === "funded") return "closed";
  if (lower === "closed") return "closed";

  return null;
}

export type JourneyMiniRailProps = {
  stage: LifecycleStage | string | null;
  className?: string;
};

export function JourneyMiniRail({ stage, className }: JourneyMiniRailProps) {
  const canonical = typeof stage === "string"
    ? legacyStageToCanonical(stage)
    : stage ?? null;

  // Workout: show all dots muted amber, label "Workout".
  if (canonical === "workout") {
    return (
      <div
        className={["flex items-center gap-1.5", className ?? ""].join(" ")}
        data-testid="journey-mini-rail"
        data-stage="workout"
        title="Workout — off the linear path"
        aria-label="Stage: Workout (off-path)"
      >
        <span className="flex items-center gap-0.5">
          {LINEAR_STAGES.map((s) => (
            <span
              key={s}
              className="block h-1.5 w-1.5 rounded-full bg-amber-500/40"
              aria-hidden
            />
          ))}
        </span>
        <span className="text-[11px] text-amber-300/70">Workout</span>
      </div>
    );
  }

  if (!canonical) {
    return (
      <div
        className={["flex items-center gap-1.5", className ?? ""].join(" ")}
        data-testid="journey-mini-rail"
        data-stage="unknown"
        title="Stage not yet derived."
        aria-label="Stage not yet derived"
      >
        <span className="flex items-center gap-0.5">
          {LINEAR_STAGES.map((s) => (
            <span
              key={s}
              className="block h-1.5 w-1.5 rounded-full bg-white/15"
              aria-hidden
            />
          ))}
        </span>
        <span className="text-[11px] text-white/40">—</span>
      </div>
    );
  }

  const idx = LINEAR_STAGES.indexOf(canonical);
  const stageNum = idx + 1;
  const total = LINEAR_STAGES.length;
  const label = STAGE_LABELS[canonical] ?? canonical;
  const summary = `Stage ${stageNum} of ${total} — ${label}`;

  return (
    <div
      className={["flex items-center gap-1.5", className ?? ""].join(" ")}
      data-testid="journey-mini-rail"
      data-stage={canonical}
      title={summary}
      aria-label={summary}
    >
      <span className="flex items-center gap-0.5" aria-hidden>
        {LINEAR_STAGES.map((s, i) => {
          const filled = i <= idx;
          const isCurrent = i === idx;
          const cls = isCurrent
            ? "bg-blue-400 ring-1 ring-blue-300/50"
            : filled
              ? "bg-emerald-500"
              : "bg-white/15";
          return (
            <span
              key={s}
              className={`block h-1.5 w-1.5 rounded-full ${cls}`}
            />
          );
        })}
      </span>
      <span className="text-[11px] text-white/70">
        {stageNum}/{total} · <span className="text-white/90">{label}</span>
      </span>
    </div>
  );
}
