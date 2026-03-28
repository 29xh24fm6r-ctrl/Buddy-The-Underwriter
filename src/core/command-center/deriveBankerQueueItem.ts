/**
 * Phase 65H — Banker Queue Item Derivation
 *
 * Produces one deterministic BankerQueueItem per deal.
 * Pure function — no DB, no side effects.
 * Composes blocking party, actionability, and queue reason.
 */

import type {
  BankerQueueItem,
  QueueItemDerivationInput,
} from "./types";
import type { CanonicalExecutionMode } from "@/core/actions/execution/canonicalActionExecutionMap";
import { deriveBlockingParty } from "./deriveBlockingParty";
import { deriveQueueActionability } from "./deriveQueueActionability";
import { deriveQueueReasonCode } from "./deriveQueueReasonCode";
import { getQueueReasonEntry } from "./queueReasonCatalog";
import { mapQueueReasonToHref } from "./mapQueueReasonToHref";

export type DeriveQueueItemOptions = {
  executionMode: CanonicalExecutionMode | null;
  isQueueJobRunning: boolean;
};

export function deriveBankerQueueItem(
  input: QueueItemDerivationInput,
  options: DeriveQueueItemOptions,
): BankerQueueItem {
  const aging = input.agingSnapshot;

  // 1. Derive queue reason (single most important)
  const queueReasonCode = deriveQueueReasonCode({
    isStageOverdue: aging.isStageOverdue,
    isPrimaryActionStale: aging.isPrimaryActionStale,
    primaryActionPriority: input.primaryActionPriority,
    borrowerRemindersExhausted: input.borrowerRemindersExhausted,
    borrowerOverdueCount: input.borrowerOverdueCount,
    reviewBacklogCount: input.reviewBacklogCount,
    blockerCodes: input.blockerCodes,
    canonicalStage: input.canonicalStage,
    stuckReasonCodes: aging.stuckReasonCodes,
  });

  const reasonEntry = getQueueReasonEntry(queueReasonCode);

  // 2. Derive blocking party
  const blockingParty = deriveBlockingParty({
    borrowerOverdueCount: input.borrowerOverdueCount,
    borrowerRemindersExhausted: input.borrowerRemindersExhausted,
    borrowerCampaignStatus: input.borrowerCampaignStatus,
    isPrimaryActionStale: aging.isPrimaryActionStale,
    primaryActionPriority: input.primaryActionPriority,
    reviewBacklogCount: input.reviewBacklogCount,
    isQueueJobRunning: options.isQueueJobRunning,
  });

  // 3. Derive actionability
  const actionability = deriveQueueActionability({
    isActionExecutable: input.isActionExecutable,
    executionMode: options.executionMode,
    blockingParty,
    queueReasonCode,
    reviewBacklogCount: input.reviewBacklogCount,
  });

  // 4. Build href
  const href = mapQueueReasonToHref(input.dealId, queueReasonCode);

  return {
    dealId: input.dealId,
    dealName: input.dealName,
    borrowerName: input.borrowerName,
    canonicalStage: input.canonicalStage,
    urgencyBucket: aging.urgencyBucket,
    urgencyScore: aging.urgencyScore,
    queueDomain: reasonEntry.domain,
    queueReasonCode,
    queueReasonLabel: reasonEntry.label,
    queueReasonDescription: reasonEntry.description,
    blockingParty,
    primaryActionCode: input.primaryActionCode,
    primaryActionLabel: input.primaryActionLabel,
    primaryActionPriority: input.primaryActionPriority,
    primaryActionAgeHours: input.agingSnapshot.primaryActionAgeHours,
    isActionExecutable: input.isActionExecutable,
    actionability,
    href,
    activeEscalationCount: input.activeEscalationCount,
    borrowerOverdueCount: input.borrowerOverdueCount,
    reviewBacklogCount: input.reviewBacklogCount,
    latestActivityAt: input.latestActivityAt,
    changedSinceViewed: input.changedSinceViewed,
  };
}
