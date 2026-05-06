// Server-only lifecycle reconciler.
//
// Looks at the unified readiness state and advances the underlying
// deal_status / deal_lifecycle stage when the readiness model has crossed a
// threshold. Idempotent: calling twice with the same state is a no-op.
//
// This reconciler does NOT compute its own readiness — it consumes the
// unified readiness object built by buildUnifiedDealReadiness, so the rule
// is "one readiness model decides everything."

import "server-only";

import type { LifecycleStage } from "@/buddy/lifecycle/model";
import { advanceDealLifecycle } from "@/buddy/lifecycle/advanceDealLifecycle";
import type { UnifiedDealReadiness } from "./types";

export type ReconcileDealLifecycleArgs = {
  dealId: string;
  readiness: UnifiedDealReadiness;
  bankerId: string;
};

export type ReconcileResult = {
  fromStage: LifecycleStage;
  toStage: LifecycleStage | null;
  advanced: boolean;
  reason: string;
};

export async function reconcileDealLifecycle(
  args: ReconcileDealLifecycleArgs,
): Promise<ReconcileResult> {
  const { dealId, readiness, bankerId } = args;
  const fromStage = readiness.stage;

  const targetStage = chooseTargetStage(readiness);
  if (!targetStage || targetStage === fromStage) {
    return {
      fromStage,
      toStage: null,
      advanced: false,
      reason: "no_change",
    };
  }

  // Only advance forward — never backwards. The lifecycle engine's
  // advanceDealLifecycle picks the single next stage; if we want to skip
  // multiple stages we have to advance repeatedly.
  let lastReason = "no_change";
  let lastAdvanced = false;
  let safetyCounter = 0;
  while (safetyCounter < 4) {
    const result = await advanceDealLifecycle(dealId, {
      type: "automation",
      id: bankerId,
    });
    if (!result.ok) {
      lastReason = result.error;
      break;
    }
    if (result.advanced) {
      lastAdvanced = true;
      if (result.state.stage === targetStage) break;
      safetyCounter += 1;
      continue;
    }
    lastReason = result.reason;
    break;
  }

  return {
    fromStage,
    toStage: lastAdvanced ? targetStage : null,
    advanced: lastAdvanced,
    reason: lastReason,
  };
}

// Decide what stage the deal SHOULD be in based on unified readiness.
// We only auto-advance through the docs/memo-inputs/underwrite-ready
// triplet — committee/decision/closing transitions remain banker-driven.
function chooseTargetStage(
  readiness: UnifiedDealReadiness,
): LifecycleStage | null {
  const docsReady = readiness.groups.documents.ready;
  const memoInputsReady = readiness.groups.memo_inputs.ready;
  const financialsReady = readiness.groups.financials.ready;
  const researchReady = readiness.groups.research.ready;

  if (!docsReady) return null;
  if (!memoInputsReady) return "memo_inputs_required";
  if (memoInputsReady && financialsReady && researchReady) {
    return "underwrite_ready";
  }
  return "memo_inputs_required";
}
