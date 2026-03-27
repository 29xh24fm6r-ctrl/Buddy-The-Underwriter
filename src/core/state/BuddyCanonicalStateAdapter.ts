import "server-only";

/**
 * BuddyCanonicalStateAdapter — Phase 65A
 *
 * The ONLY place deal state is composed.
 * Wraps existing derivation functions — does NOT replace them.
 * NO new business logic. Only: extract, normalize, unify.
 */

import { deriveLifecycleState } from "@/buddy/lifecycle";
import { getNextAction } from "@/buddy/lifecycle/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  BuddyCanonicalState,
  PricingState,
  CommitteeState,
  ExceptionSummary,
  ChecklistReadiness,
  SystemAction,
} from "./types";

/**
 * Compose the single canonical state for a deal.
 * Calls existing derivation functions — no new logic.
 */
export async function getBuddyCanonicalState(
  dealId: string,
): Promise<BuddyCanonicalState> {
  // 1. Derive lifecycle (already composes 14+ data sources)
  const lifecycleState = await deriveLifecycleState(dealId);

  // 2. Extract pricing state from derived fields
  const pricingState: PricingState = {
    hasPricingAssumptions: lifecycleState.derived.hasPricingAssumptions,
    pricingQuoteReady: lifecycleState.derived.pricingQuoteReady,
    riskPricingFinalized: lifecycleState.derived.riskPricingFinalized,
    structuralPricingReady: lifecycleState.derived.structuralPricingReady,
  };

  // 3. Extract committee state from derived fields
  const committeeState: CommitteeState = {
    required: lifecycleState.derived.committeeRequired,
    outcome: lifecycleState.derived.decisionPresent ? "approve" : "pending",
    voteCount: 0,
    quorum: 0,
    complete: lifecycleState.derived.decisionPresent,
  };

  // 4. Extract exception state
  const exceptionState = await deriveExceptionSummary(dealId);

  // 5. Extract checklist readiness from derived
  const checklistReadiness: ChecklistReadiness = {
    ready: lifecycleState.derived.documentsReady,
    reason: lifecycleState.derived.documentsReady
      ? "All required documents received"
      : `Document readiness at ${lifecycleState.derived.documentsReadinessPct?.toFixed(0) ?? 0}%`,
    totalItems: 0,
    satisfiedItems: 0,
    missingItems: 0,
  };

  // 6. Derive next required action (100% Buddy-owned)
  const rawAction = getNextAction(lifecycleState, dealId);
  const nextRequiredAction: SystemAction = {
    label: rawAction.label,
    href: rawAction.href,
    intent: rawAction.intent,
    description: rawAction.description,
  };

  return {
    dealId,
    lifecycle: lifecycleState.stage,
    blockers: lifecycleState.blockers,
    derived: lifecycleState.derived,
    pricingState,
    committeeState,
    checklistReadiness,
    exceptionState,
    nextRequiredAction,
    derivedAt: new Date().toISOString(),
  };
}

/** Derive exception summary from deal_policy_exceptions */
async function deriveExceptionSummary(dealId: string): Promise<ExceptionSummary> {
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("deal_policy_exceptions")
      .select("status, severity")
      .eq("deal_id", dealId)
      .in("status", ["open", "pending_review", "escalated"]);

    const open = data ?? [];
    return {
      openCount: open.length,
      criticalCount: open.filter((e: any) => e.severity === "critical" || e.severity === "high").length,
      hasEscalated: open.some((e: any) => e.status === "escalated"),
    };
  } catch {
    return { openCount: 0, criticalCount: 0, hasEscalated: false };
  }
}
