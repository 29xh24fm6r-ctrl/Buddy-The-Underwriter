import "server-only";

/**
 * Phase 65G — Deal Aging Snapshot Derivation
 *
 * Computes the full time-state of a deal from evidence.
 * Composes tempo helpers + stuckness + urgency into a single snapshot.
 */

import type { BuddyNextAction } from "@/core/actions/types";
import type { DealAgingSnapshot } from "./types";
import { getStageSla, OBJECT_SLA_POLICY } from "./slaPolicy";
import { detectDealStuckness } from "./detectDealStuckness";
import { deriveDealUrgency } from "./deriveDealUrgency";
import { getStageStartedAt } from "@/lib/tempo/getStageStartedAt";
import { getPrimaryActionStartedAt } from "@/lib/tempo/getPrimaryActionStartedAt";
import { getBorrowerCampaignAging } from "@/lib/tempo/getBorrowerCampaignAging";
import { getReviewQueueAging } from "@/lib/tempo/getReviewQueueAging";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type AgingSnapshotInput = {
  dealId: string;
  canonicalStage: string;
  blockerCodes: string[];
  primaryAction: BuddyNextAction | null;
};

export async function deriveDealAgingSnapshot(
  input: AgingSnapshotInput,
): Promise<DealAgingSnapshot> {
  const now = Date.now();

  // Parallel data fetches
  const [stageStarted, campaignAging, reviewAging] = await Promise.all([
    getStageStartedAt(input.dealId, input.canonicalStage),
    getBorrowerCampaignAging(input.dealId),
    getReviewQueueAging(input.dealId),
  ]);

  const stageAgeHours = stageStarted
    ? Math.floor((now - new Date(stageStarted).getTime()) / (3600 * 1000))
    : 0;

  const actionCode = input.primaryAction?.code ?? null;
  const actionStarted = await getPrimaryActionStartedAt(input.dealId, actionCode);
  const primaryActionAgeHours = actionStarted
    ? Math.floor((now - new Date(actionStarted).getTime()) / (3600 * 1000))
    : null;

  // Stage SLA check
  const stageSla = getStageSla(input.canonicalStage);
  const isStageOverdue = stageAgeHours >= stageSla.urgentHours;

  // Primary action stale check
  const actionPriority = input.primaryAction?.priority ?? null;
  let isPrimaryActionStale = false;
  if (primaryActionAgeHours !== null && actionPriority) {
    const threshold =
      actionPriority === "critical"
        ? OBJECT_SLA_POLICY.primaryAction.criticalActionStaleHours
        : actionPriority === "high"
          ? OBJECT_SLA_POLICY.primaryAction.highActionStaleHours
          : OBJECT_SLA_POLICY.primaryAction.normalActionStaleHours;
    isPrimaryActionStale = primaryActionAgeHours >= threshold;
  }

  // Active escalation count
  const sb = supabaseAdmin();
  const { count: activeEscalations } = await sb
    .from("deal_escalation_events")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", input.dealId)
    .eq("is_active", true);

  // Detect stuckness
  const stucknessResult = detectDealStuckness({
    canonicalStage: input.canonicalStage,
    stageAgeHours,
    primaryActionCode: actionCode,
    primaryActionPriority: actionPriority,
    primaryActionAgeHours,
    borrowerCampaignsOpen: campaignAging.open,
    borrowerCampaignsOverdue: campaignAging.overdue,
    criticalItemsOverdue: campaignAging.criticalItemsOverdue,
    bankerTasksStale: reviewAging.bankerTasksStale,
    uploadsWaitingReview: reviewAging.uploadsWaitingReview,
    hasUnresolvedMemoBlockers: input.blockerCodes.some(
      (b) => b === "committee_packet_missing" || b === "decision_missing",
    ),
    hasUnresolvedPricingBlockers: input.blockerCodes.some(
      (b) =>
        b === "pricing_assumptions_required" ||
        b === "risk_pricing_not_finalized" ||
        b === "structural_pricing_missing" ||
        b === "pricing_quote_missing",
    ),
    isClosingStage: input.canonicalStage === "closing_in_progress",
    isBorrowerBlocking: campaignAging.open > 0 && campaignAging.criticalItemsOverdue > 0,
  });

  // Derive urgency
  const urgencyResult = deriveDealUrgency({
    isStageOverdue,
    isPrimaryActionStale,
    borrowerCampaignsOverdue: campaignAging.overdue,
    criticalItemsOverdue: campaignAging.criticalItemsOverdue,
    uploadsWaitingReview: reviewAging.uploadsWaitingReview,
    bankerTasksStale: reviewAging.bankerTasksStale,
    activeEscalationCount: activeEscalations ?? 0,
    stuckReasonCodes: stucknessResult.stuckReasonCodes,
  });

  return {
    dealId: input.dealId,
    canonicalStage: input.canonicalStage,
    stageStartedAt: stageStarted,
    stageAgeHours,
    primaryActionCode: actionCode,
    primaryActionAgeHours,
    borrowerCampaignsOpen: campaignAging.open,
    borrowerCampaignsOverdue: campaignAging.overdue,
    criticalItemsOverdue: campaignAging.criticalItemsOverdue,
    bankerTasksStale: reviewAging.bankerTasksStale,
    isStageOverdue,
    isPrimaryActionStale,
    isDealStuck: stucknessResult.isDealStuck,
    urgencyScore: urgencyResult.urgencyScore,
    urgencyBucket: urgencyResult.urgencyBucket,
    stuckReasonCodes: stucknessResult.stuckReasonCodes,
  };
}
