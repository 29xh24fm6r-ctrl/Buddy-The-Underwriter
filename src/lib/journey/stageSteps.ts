/**
 * SPEC-GUIDED-STAGE-RAIL-1 — pure projection: LifecycleState → per-stage step checklist.
 * A "step" is a blocker gated to a stage (blockerGatesStage), labeled by its FixAction.
 * Pure: no IO. The model layer (blockers/fix actions) is the single source of truth.
 */
import type { LifecycleBlocker, LifecycleStage, LifecycleState } from "@/buddy/lifecycle/model";
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

/** Open steps for one stage, ordered by underwriting workstream where applicable. */
export function stepsForStage(
  state: LifecycleState,
  stage: LifecycleStage,
  dealId: string,
): StageStep[] {
  const gated = state.blockers.filter((b) => {
    try { return blockerGatesStage(b.code) === stage; } catch { return false; }
  });

  const ordered = [...gated].sort((a, b) => {
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
