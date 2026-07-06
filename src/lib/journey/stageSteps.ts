/**
 * SPEC-GUIDED-STAGE-RAIL-1 / -1B — pure projection: LifecycleState → current-stage step checklist.
 * A "step" is an open, non-infrastructure blocker (blockerGatesStage !== null), labeled by its
 * FixAction. Pure: no IO. The model layer (blockers/fix actions) is the single source of truth.
 */
import type { LifecycleBlocker, LifecycleState } from "@/buddy/lifecycle/model";
import { blockerGatesStage } from "@/buddy/lifecycle/blockerToStage";
import { getBlockerFixAction } from "@/buddy/lifecycle/nextAction";
import {
  INTRA_WORKSTREAM_PRIORITY,
  SYSTEM_COMPUTED_BLOCKERS,
  UNDERWRITING_WORKSTREAM_ORDER,
  workstreamForBlocker,
} from "@/lib/journey/journeyActionProjection";

export type StageStep = {
  code: LifecycleBlocker["code"];
  label: string;          // FixAction label, else blocker.message
  message: string;        // blocker.message (secondary line)
  href: string | null;    // FixAction href; null for action-only/unmapped fixes
  open: boolean;          // true = still blocking (undone)
  system: boolean;        // true = Buddy-computed, not a banker action
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
    // Primary: banker workstream order.
    const wa = workstreamForBlocker(a.code);
    const wb = workstreamForBlocker(b.code);
    const ia = wa ? UNDERWRITING_WORKSTREAM_ORDER.indexOf(wa) : Number.MAX_SAFE_INTEGER;
    const ib = wb ? UNDERWRITING_WORKSTREAM_ORDER.indexOf(wb) : Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    // Secondary: intra-workstream dependency order (e.g. business cash flow before GCF before DSCR).
    const pa = INTRA_WORKSTREAM_PRIORITY[a.code] ?? Number.MAX_SAFE_INTEGER;
    const pb = INTRA_WORKSTREAM_PRIORITY[b.code] ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    // Tertiary: system-computed steps sort below actionable banker steps
    // within the same workstream position.
    const sa = SYSTEM_COMPUTED_BLOCKERS.has(a.code) ? 1 : 0;
    const sb = SYSTEM_COMPUTED_BLOCKERS.has(b.code) ? 1 : 0;
    return sa - sb;
  });

  // Deduplicate by label+href — two blockers with identical fix actions
  // (e.g. missing_business_description + missing_revenue_model both →
  // "Complete borrower story"; missing_business_cash_flow + missing_dscr both →
  // "Run financial analysis") render as one step. First occurrence wins, so the
  // dependency-ordered sort above decides which code represents the merged step.
  const seen = new Set<string>();
  const deduped: StageStep[] = [];
  for (const b of ordered) {
    const fix = getBlockerFixAction(b, dealId);
    const step: StageStep = {
      code: b.code,
      label: fix?.label ?? b.message,
      message: b.message,
      href: fix && "href" in fix && typeof fix.href === "string" ? fix.href : null,
      open: true,
      system: SYSTEM_COMPUTED_BLOCKERS.has(b.code),
    };
    const dedupKey = `${step.label}||${step.href ?? ""}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    deduped.push(step);
  }

  return deduped;
}

/** True when the current stage has zero gated blockers AND zero infra blockers — safe to auto-advance. */
export function stageClearForAdvance(state: LifecycleState): boolean {
  if (!state) return false;
  if (state.stage === "closed" || state.stage === "workout") return false;
  return state.blockers.length === 0;
}
