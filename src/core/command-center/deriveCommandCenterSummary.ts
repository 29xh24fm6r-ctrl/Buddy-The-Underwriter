/**
 * Phase 65H — Command Center Summary Derivation
 *
 * Derives summary metrics from the same queue items — one source of truth.
 * Pure function — no DB, no side effects.
 */

import type { BankerQueueItem, CommandCenterSummary } from "./types";

export function deriveCommandCenterSummary(
  items: BankerQueueItem[],
  autoAdvancedTodayCount: number,
): CommandCenterSummary {
  let criticalCount = 0;
  let urgentCount = 0;
  let borrowerWaitingOnBankCount = 0;
  let bankWaitingOnBorrowerCount = 0;
  let stalePrimaryActionCount = 0;

  for (const item of items) {
    if (item.urgencyBucket === "critical") criticalCount++;
    if (item.urgencyBucket === "urgent") urgentCount++;

    if (
      item.blockingParty === "banker" ||
      item.queueReasonCode === "uploads_waiting_review"
    ) {
      borrowerWaitingOnBankCount++;
    }

    if (
      item.blockingParty === "borrower" ||
      item.queueReasonCode === "borrower_items_overdue" ||
      item.queueReasonCode === "borrower_reminders_exhausted"
    ) {
      bankWaitingOnBorrowerCount++;
    }

    if (
      item.queueReasonCode === "critical_primary_action_stale" ||
      (item.primaryActionAgeHours !== null && item.primaryActionAgeHours > 24)
    ) {
      stalePrimaryActionCount++;
    }
  }

  return {
    totalDeals: items.length,
    criticalCount,
    urgentCount,
    borrowerWaitingOnBankCount,
    bankWaitingOnBorrowerCount,
    autoAdvancedTodayCount,
    stalePrimaryActionCount,
  };
}
