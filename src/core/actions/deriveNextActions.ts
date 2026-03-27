/**
 * Action Engine — Phase 65D
 *
 * Derives deterministic next actions from canonical state + explanation.
 * No Omega input. Pure function.
 */

import { ACTION_CATALOG } from "./actionCatalog";
import { BLOCKER_ACTION_MAP } from "./blockerActionMap";
import type {
  BuddyActionCode,
  BuddyActionDerivationInput,
  BuddyActionDerivationResult,
  BuddyNextAction,
} from "./types";
import type { LifecycleStage } from "@/buddy/lifecycle/model";

const PRIORITY_RANK = { critical: 0, high: 1, normal: 2 } as const;

/** Stage → fallback actions when no blockers exist */
const STAGE_FALLBACK_ACTIONS: Partial<Record<LifecycleStage, BuddyActionCode[]>> = {
  intake_created: ["seed_checklist"],
  docs_requested: ["request_documents"],
  docs_in_progress: ["review_uploaded_documents"],
  docs_satisfied: ["set_pricing_assumptions"],
  underwrite_ready: ["start_underwriting"],
  underwrite_in_progress: ["review_credit_memo"],
  committee_ready: ["review_credit_memo"],
  committee_decisioned: ["start_closing"],
  closing_in_progress: ["complete_closing"],
  closed: ["no_action_required"],
  workout: ["no_action_required"],
};

function makeAction(code: BuddyActionCode, blockingFactorCodes: string[] = []): BuddyNextAction {
  const template = ACTION_CATALOG[code];
  return { ...template, blockingFactorCodes };
}

function dedupeActions(actions: BuddyNextAction[]): BuddyNextAction[] {
  const byCode = new Map<string, BuddyNextAction>();
  for (const action of actions) {
    const existing = byCode.get(action.code);
    if (!existing) {
      byCode.set(action.code, action);
    } else {
      byCode.set(action.code, {
        ...existing,
        blockingFactorCodes: Array.from(new Set([...existing.blockingFactorCodes, ...action.blockingFactorCodes])),
      });
    }
  }
  return Array.from(byCode.values());
}

function sortActions(actions: BuddyNextAction[]): BuddyNextAction[] {
  return [...actions].sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    return a.label.localeCompare(b.label);
  });
}

export function deriveNextActions({
  canonicalState,
  explanation,
}: BuddyActionDerivationInput): BuddyActionDerivationResult {
  // 1. Blocker-driven actions
  const blockerCodes = canonicalState.blockers.map((b) => b.code);
  const blockerDriven = blockerCodes.flatMap((code) => {
    const actionCodes = BLOCKER_ACTION_MAP[code] ?? ["resolve_readiness_blockers"];
    return actionCodes.map((ac) => makeAction(ac, [code]));
  });

  // 2. Stage fallback if no blockers
  const fallback = blockerDriven.length === 0
    ? (STAGE_FALLBACK_ACTIONS[canonicalState.lifecycle] ?? ["no_action_required"]).map((c) => makeAction(c))
    : [];

  // 3. Dedupe, sort
  const nextActions = sortActions(dedupeActions([...blockerDriven, ...fallback]));
  const safe = nextActions.length > 0 ? nextActions : [makeAction("no_action_required")];

  return {
    nextActions: safe,
    primaryAction: safe[0] ?? null,
  };
}
