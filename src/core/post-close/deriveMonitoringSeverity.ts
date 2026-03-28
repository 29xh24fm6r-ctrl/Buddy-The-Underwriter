/**
 * Phase 65I — Monitoring Severity Derivation
 *
 * Pure function — no DB, no side effects.
 */

import type { MonitoringSeverity, MonitoringCycleStatus } from "./types";

export type SeverityInput = {
  cycleStatus: MonitoringCycleStatus;
  dueAt: string;
  hasOpenException: boolean;
  isCovenantRelated: boolean;
  overdueCount: number;
};

export function deriveMonitoringSeverity(input: SeverityInput): MonitoringSeverity {
  // Critical: repeated miss, open exception on covenant, or aged overdue
  if (input.isCovenantRelated && input.hasOpenException) {
    return "critical";
  }

  if (input.overdueCount >= 2) {
    return "critical";
  }

  if (input.cycleStatus === "overdue" || input.cycleStatus === "exception_open") {
    return "urgent";
  }

  // Watch: due soon (within 7 days) or minor delay
  if (input.cycleStatus === "due") {
    const daysUntilDue = Math.floor(
      (new Date(input.dueAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    if (daysUntilDue <= 7) return "watch";
  }

  if (input.cycleStatus === "under_review") {
    return "watch";
  }

  // Healthy: upcoming, completed, waived
  return "healthy";
}
