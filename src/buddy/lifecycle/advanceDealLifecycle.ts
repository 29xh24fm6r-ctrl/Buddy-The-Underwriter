/**
 * Advance Deal Lifecycle
 *
 * Unified function to advance a deal through lifecycle stages.
 * Composes with existing advanceDealLifecycle from advanceDealLifecycleCore.ts.
 *
 * Flow:
 * 1. Derive current state
 * 2. Compute next eligible stage
 * 3. Check for blockers
 * 4. If clear, emit ledger event and advance underlying stage if needed
 * 5. Return new state
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { advanceDealLifecycle as advanceDealLifecycleCore } from "@/lib/deals/advanceDealLifecycleCore";
import { deriveLifecycleState } from "./deriveLifecycleState";
import { LedgerEventType } from "./events";
import { upsertDealStatusAndLog, type DealStage } from "@/lib/deals/status";
import type {
  LifecycleStage,
  LifecycleState,
  LifecycleBlocker,
  ActorContext,
  AdvanceLifecycleResult,
  ALLOWED_STAGE_TRANSITIONS,
} from "./model";
import { ALLOWED_STAGE_TRANSITIONS as TRANSITIONS } from "./model";

/**
 * Attempt to advance a deal's lifecycle to the next stage.
 *
 * This is the ONLY authorized way to move lifecycle forward.
 * It ensures:
 * - State is derived (not manually set)
 * - Blockers are checked
 * - Events are logged to canonical ledger
 * - Underlying stage model is updated if needed
 */
export async function advanceDealLifecycle(
  dealId: string,
  actor: ActorContext
): Promise<AdvanceLifecycleResult> {
  // 1. Derive current state
  const state = await deriveLifecycleState(dealId);

  // Check for deal not found
  if (state.blockers.some((b) => b.code === "deal_not_found")) {
    return { ok: false, error: "deal_not_found" };
  }

  // 2. Compute next eligible stage
  const nextStage = computeNextStage(state.stage);

  if (!nextStage) {
    return {
      ok: true,
      advanced: false,
      state,
      reason: `No advancement possible from ${state.stage} (terminal or no valid transitions)`,
    };
  }

  // 3. Check for blockers that prevent this transition
  const blockingBlockers = getBlockersForTransition(state, nextStage);

  if (blockingBlockers.length > 0) {
    // Emit blocked telemetry event (fire-and-forget)
    writeEvent({
      dealId,
      kind: LedgerEventType.lifecycle_blocked,
      actorUserId: actor.id,
      input: {
        stage: state.stage,
        targetStage: nextStage,
        blockers: blockingBlockers.map((b) => b.code),
      },
    }).catch(() => {});

    return {
      ok: false,
      error: "blocked",
      blockers: blockingBlockers,
      allBlockers: state.blockers,
      state,
    };
  }

  // 4. Emit lifecycle advancement event
  await writeEvent({
    dealId,
    kind: LedgerEventType.lifecycle_advanced,
    actorUserId: actor.id,
    input: {
      from: state.stage,
      to: nextStage,
      actor: {
        type: actor.type,
        id: actor.id,
      },
    },
  });

  // 5. Advance underlying stage model if needed
  const underlyingStage = mapToUnderlyingStage(nextStage);
  if (underlyingStage) {
    const result = await advanceDealLifecycleCore({
      dealId,
      toStage: underlyingStage,
      reason: `unified_lifecycle_advance_to_${nextStage}`,
      source: "buddy_lifecycle",
      actor: {
        userId: actor.id,
        type: actor.type === "system" ? "system" : "user",
        label: actor.type,
      },
    });

    // If the underlying advance fails, it's not necessarily a problem
    // The unified stage may have advanced without the underlying stage changing
    if (!result.ok && result.error !== "invalid_transition") {
      console.warn(
        `[advanceDealLifecycle] Underlying stage advance warning: ${result.error}`,
        { dealId, nextStage, underlyingStage }
      );
    }
  }

  // 6. Sync borrower-facing deal_status (fail-soft)
  await syncBorrowerStatus(dealId, nextStage, actor);

  // 7. Re-derive state to return current truth
  const newState = await deriveLifecycleState(dealId);

  return {
    ok: true,
    advanced: true,
    state: newState,
  };
}

/**
 * Map unified lifecycle stage to borrower-facing deal status stage.
 * Returns null if no borrower status change is needed for this stage.
 */
function mapToBorrowerStage(stage: LifecycleStage): DealStage | null {
  switch (stage) {
    case "docs_requested":
    case "docs_in_progress":
      return "docs_in_progress";
    case "docs_satisfied":
    case "underwrite_ready":
      return "analysis";
    case "underwrite_in_progress":
      return "underwriting";
    case "committee_ready":
    case "committee_decisioned":
      return "conditional_approval";
    case "closing_in_progress":
      return "closing";
    case "closed":
      return "funded";
    default:
      return null;
  }
}

/**
 * Sync borrower-facing deal_status after a lifecycle advancement.
 * Fail-soft: never throws, never blocks the lifecycle advance.
 */
async function syncBorrowerStatus(
  dealId: string,
  stage: LifecycleStage,
  actor: ActorContext
): Promise<void> {
  const borrowerStage = mapToBorrowerStage(stage);
  if (!borrowerStage) return;

  try {
    await upsertDealStatusAndLog({
      dealId,
      stage: borrowerStage,
      actorUserId: actor.id,
    });

    await writeEvent({
      dealId,
      kind: LedgerEventType.status_synced,
      actorUserId: actor.id,
      input: {
        unifiedStage: stage,
        borrowerStage,
      },
    });
  } catch (err) {
    console.warn("[advanceDealLifecycle] Borrower status sync failed (non-fatal):", err);
  }
}

/**
 * Compute the next stage from current stage.
 * Returns null if no advancement is possible (terminal state).
 */
function computeNextStage(currentStage: LifecycleStage): LifecycleStage | null {
  const allowed = TRANSITIONS[currentStage];
  if (!allowed || allowed.length === 0) {
    return null;
  }
  // For linear progression, return the first (and usually only) allowed next stage
  return allowed[0];
}

/**
 * Get blockers that specifically prevent the given transition.
 * Some blockers are informational and don't prevent all transitions.
 */
function getBlockersForTransition(
  state: LifecycleState,
  nextStage: LifecycleStage
): LifecycleBlocker[] {
  // For now, all blockers prevent advancement
  // In the future, we could make some blockers stage-specific
  return state.blockers.filter((blocker) => {
    // Map blocker codes to the stages they block
    switch (blocker.code) {
      case "deal_not_found":
        return true; // Always blocking

      case "checklist_not_seeded":
        return nextStage === "docs_requested"; // Blocks moving to docs_requested

      case "missing_required_docs":
        return ["docs_satisfied", "underwrite_ready"].includes(nextStage);

      case "financial_snapshot_missing":
        return nextStage === "underwrite_ready";

      case "underwrite_not_started":
        return nextStage === "underwrite_in_progress";

      case "committee_packet_missing":
        return nextStage === "committee_ready";

      case "decision_missing":
        return nextStage === "committee_decisioned";

      case "attestation_missing":
        return nextStage === "closing_in_progress";

      case "closing_docs_missing":
        return nextStage === "closed";

      case "risk_pricing_not_finalized":
        return nextStage === "committee_ready";

      case "structural_pricing_missing":
        return nextStage === "committee_ready";

      case "pricing_quote_missing":
        return nextStage === "committee_decisioned";

      default:
        return false; // Unknown blockers don't block by default
    }
  });
}

/**
 * Map unified stage to underlying DealLifecycleStage.
 * Returns null if no underlying stage change is needed.
 */
function mapToUnderlyingStage(
  unifiedStage: LifecycleStage
): "intake" | "collecting" | "underwriting" | "ready" | null {
  switch (unifiedStage) {
    case "docs_requested":
      return "intake";
    case "docs_in_progress":
    case "docs_satisfied":
    case "underwrite_ready":
      return "collecting";
    case "underwrite_in_progress":
      return "underwriting";
    case "committee_ready":
    case "committee_decisioned":
      return "ready";
    default:
      return null; // No underlying stage change needed
  }
}

/**
 * Audit metadata captured at the request boundary for force-advance events.
 */
export type ForceAdvanceAuditMeta = {
  client_ip?: string;
  user_agent?: string;
  correlation_id?: string;
};

/**
 * Force advance to a specific stage (admin use only).
 * Bypasses some blocker checks but still logs events.
 */
export async function forceAdvanceLifecycle(
  dealId: string,
  targetStage: LifecycleStage,
  actor: ActorContext,
  reason: string,
  auditMeta?: ForceAdvanceAuditMeta
): Promise<AdvanceLifecycleResult> {
  const state = await deriveLifecycleState(dealId);

  if (state.blockers.some((b) => b.code === "deal_not_found")) {
    return { ok: false, error: "deal_not_found" };
  }

  // Log the force advancement with dedicated event type + audit trail
  await writeEvent({
    dealId,
    kind: LedgerEventType.lifecycle_force_advanced,
    actorUserId: actor.id,
    input: {
      from: state.stage,
      to: targetStage,
      forced: true,
      reason,
      actor: {
        type: actor.type,
        id: actor.id,
      },
      ...(auditMeta && { audit: auditMeta }),
    },
  });

  // Advance underlying stage if needed
  const underlyingStage = mapToUnderlyingStage(targetStage);
  if (underlyingStage) {
    await advanceDealLifecycleCore({
      dealId,
      toStage: underlyingStage,
      reason: `force_advance_to_${targetStage}: ${reason}`,
      source: "buddy_lifecycle_force",
      actor: {
        userId: actor.id,
        type: actor.type === "system" ? "system" : "user",
        label: `force:${actor.type}`,
      },
    });
  }

  // Sync borrower-facing deal_status (fail-soft)
  await syncBorrowerStatus(dealId, targetStage, actor);

  const newState = await deriveLifecycleState(dealId);
  return {
    ok: true,
    advanced: true,
    state: newState,
  };
}
