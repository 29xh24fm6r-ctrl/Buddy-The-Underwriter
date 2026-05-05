"use client";

import type { LifecycleBlocker, LifecycleStage, LifecycleState } from "@/buddy/lifecycle/model";
import { getNextAction } from "@/buddy/lifecycle/nextAction";
import { blockerGatesStage } from "@/buddy/lifecycle/blockerToStage";
import { useJourneyState } from "@/hooks/useJourneyState";
import { stageCanonicalRoute } from "./stageRoutes";
import { StageRow, type StageStatus } from "./StageRow";
import { RailHeader } from "./RailHeader";

/**
 * Canonical lifecycle order. Includes the workout branch as a final off-path row.
 * Sourced from src/buddy/lifecycle/model.ts.
 */
const CANONICAL_STAGES: LifecycleStage[] = [
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
  "workout",
];

const LINEAR_STAGES = CANONICAL_STAGES.filter((s) => s !== "workout");

export type JourneyRailProps = {
  dealId: string;
  initialState?: LifecycleState | null;
  variant?: "vertical" | "horizontal";
  className?: string;
  dealLabel?: string | null;
  borrowerName?: string | null;
};

type StageBlockerMap = Map<LifecycleStage, LifecycleBlocker[]>;

function partitionBlockers(state: LifecycleState | null): {
  perStage: StageBlockerMap;
  infrastructure: LifecycleBlocker[];
} {
  const perStage: StageBlockerMap = new Map();
  const infrastructure: LifecycleBlocker[] = [];

  if (!state) return { perStage, infrastructure };

  for (const blocker of state.blockers) {
    let gated: LifecycleStage | null = null;
    try {
      gated = blockerGatesStage(blocker.code);
    } catch {
      gated = null;
    }
    if (gated) {
      const list = perStage.get(gated) ?? [];
      list.push(blocker);
      perStage.set(gated, list);
    } else {
      infrastructure.push(blocker);
    }
  }

  return { perStage, infrastructure };
}

function deriveStatus(
  stage: LifecycleStage,
  currentStage: LifecycleStage | null,
  hasAnyBlocker: boolean,
  perStage: StageBlockerMap,
): StageStatus {
  // Workout row is special: current if active, off-path otherwise.
  if (stage === "workout") {
    return currentStage === "workout" ? "current" : "skipped";
  }

  // Unknown / no current stage: render everything as locked-but-not-broken.
  if (!currentStage) return "locked";

  // If deal is on workout, the linear path is dimmed.
  if (currentStage === "workout") return "skipped";

  const currentIndex = LINEAR_STAGES.indexOf(currentStage);
  const stageIndex = LINEAR_STAGES.indexOf(stage);

  // Unknown stage in linear order — fall back safely.
  if (stageIndex < 0 || currentIndex < 0) return "locked";

  if (stageIndex < currentIndex) return "complete";
  if (stageIndex === currentIndex) return "current";

  // Future stages: "next" if directly next AND no blockers AND this stage isn't gated.
  if (stageIndex === currentIndex + 1) {
    const stageHasBlockers = (perStage.get(stage)?.length ?? 0) > 0;
    if (!hasAnyBlocker && !stageHasBlockers) return "next";
    return "locked";
  }

  return "locked";
}

function isKnownStage(stage: string | null | undefined): stage is LifecycleStage {
  if (!stage) return false;
  return (CANONICAL_STAGES as string[]).includes(stage);
}

export function JourneyRail({
  dealId,
  initialState,
  variant = "vertical",
  className,
  dealLabel,
  borrowerName,
}: JourneyRailProps) {
  const { state, loading, error } = useJourneyState(dealId, { initialState });
  const currentStage: LifecycleStage | null = isKnownStage(state?.stage)
    ? (state!.stage as LifecycleStage)
    : null;

  if (state?.stage && !isKnownStage(state.stage) && process.env.NODE_ENV !== "production") {
    console.warn(`[JourneyRail] Unknown lifecycle stage: ${state.stage}`);
  }

  const { perStage, infrastructure } = partitionBlockers(state);
  const action =
    state && currentStage ? getNextAction(state, dealId) : null;
  const hasAnyBlocker = (state?.blockers.length ?? 0) > 0;

  const stagesToRender = CANONICAL_STAGES;

  if (variant === "horizontal") {
    return (
      <nav
        aria-label="Deal journey"
        data-testid="journey-rail"
        data-variant="horizontal"
        className={[
          "lg:hidden flex items-center gap-1 overflow-x-auto no-scrollbar border-b border-white/10 bg-black/20 px-3 py-2",
          className ?? "",
        ].join(" ")}
      >
        {stagesToRender.map((stage, idx) => {
          const status = deriveStatus(stage, currentStage, hasAnyBlocker, perStage);
          if (stage === "workout" && status === "skipped") return null;
          return (
            <StageRow
              key={stage}
              stage={stage}
              index={idx}
              status={status}
              href={stageCanonicalRoute(stage, dealId)}
              dealId={dealId}
              variant="horizontal"
            />
          );
        })}
      </nav>
    );
  }

  return (
    <aside
      aria-label="Deal journey"
      data-testid="journey-rail"
      data-variant="vertical"
      className={[
        "hidden lg:flex flex-col w-[260px] shrink-0 border-r border-white/10 bg-black/20",
        className ?? "",
      ].join(" ")}
    >
      <RailHeader
        dealId={dealId}
        dealLabel={dealLabel}
        borrowerName={borrowerName}
        state={state}
        loading={loading}
      />

      {error ? (
        <div
          role="alert"
          className="mx-3 mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200"
          data-testid="journey-rail-error"
        >
          Lifecycle unavailable. Retrying…
        </div>
      ) : null}

      {infrastructure.length > 0 ? (
        <div
          role="alert"
          className="mx-3 mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200"
          data-testid="journey-rail-infra-blocker"
        >
          <div className="font-semibold">Service issue</div>
          <ul className="list-disc pl-4">
            {infrastructure.map((b) => (
              <li key={b.code}>{b.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ol
        role="list"
        className="flex-1 overflow-y-auto px-2 py-3 space-y-1"
        aria-label="Lifecycle stages"
      >
        {stagesToRender.map((stage, idx) => {
          const status = deriveStatus(stage, currentStage, hasAnyBlocker, perStage);
          // When deal is not on workout, hide the workout row as off-path skipped row at bottom.
          // We still render it for visibility, dimmed.
          const stageBlockers =
            status === "locked" ? perStage.get(stage) ?? [] : [];
          return (
            <StageRow
              key={stage}
              stage={stage}
              index={idx}
              status={status}
              href={stageCanonicalRoute(stage, dealId)}
              dealId={dealId}
              blockers={stageBlockers}
              action={status === "current" ? action : null}
            />
          );
        })}
      </ol>
    </aside>
  );
}

// Used by tests to assert the canonical ordering remains in lockstep with model.ts.
export const __JOURNEY_RAIL_CANONICAL_STAGES = CANONICAL_STAGES;
