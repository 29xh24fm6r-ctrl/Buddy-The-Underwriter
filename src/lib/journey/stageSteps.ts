/**
 * SPEC-GUIDED-STAGE-RAIL-1 / -1B — pure projection: LifecycleState → current-stage step checklist.
 * A "step" is an open, non-infrastructure blocker (blockerGatesStage !== null), labeled by its
 * FixAction. Pure: no IO. The model layer (blockers/fix actions) is the single source of truth.
 */
import type { LifecycleBlocker, LifecycleState } from "@/buddy/lifecycle/model";
import { blockerGatesStage } from "@/buddy/lifecycle/blockerToStage";
import { getBlockerFixAction } from "@/buddy/lifecycle/nextAction";
import {
  UNDERWRITING_WORKSTREAM_ORDER,
  workstreamForBlocker,
} from "@/lib/journey/journeyActionProjection";

export type StageStep = {
  code: LifecycleBlocker["code"];
  label: string;          // FixAction label, else blocker.message
  message: string;        // blocker.message (secondary line)
  href: string | null;    // FixAction href; null for action-only/unmapped fixes
  open: boolean;          // true = still blocking (undone)
};

/**
 * SPEC-GUIDED-STAGE-RAIL-1B — the current stage's checklist is EVERY open,
 * non-infrastructure blocker (all remaining work on the path), ordered by
 * banker workstream then blocker order. blockerGatesStage(code) === null
 * (infra/fetch errors) are excluded — the rail-level banner owns those.
 * The first item always agrees with buildJourneyPrimaryAction's top pick.
 */
export function stepsForCurrentStage(
  state: LifecycleState,
  dealId: string,
): StageStep[] {
  const work = state.blockers.filter((b) => {
    try { return blockerGatesStage(b.code) !== null; } catch { return false; }
  });

  const ordered = [...work].sort((a, b) => {
    const wa = workstreamForBlocker(a.code);
    const wb = workstreamForBlocker(b.code);
    const ia = wa ? UNDERWRITING_WORKSTREAM_ORDER.indexOf(wa) : Number.MAX_SAFE_INTEGER;
    const ib = wb ? UNDERWRITING_WORKSTREAM_ORDER.indexOf(wb) : Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });

  return ordered.map((b) => {
    const fix = getBlockerFixAction(b, dealId);
    return {
      code: b.code,
      label: fix?.label ?? b.message,
      message: b.message,
      href: fix && "href" in fix && typeof fix.href === "string" ? fix.href : null,
      open: true,
    };
  });
}

/** True when the current stage has zero gated blockers AND zero infra blockers — safe to auto-advance. */
export function stageClearForAdvance(state: LifecycleState): boolean {
  if (!state) return false;
  if (state.stage === "closed" || state.stage === "workout") return false;
  return state.blockers.length === 0;
}
