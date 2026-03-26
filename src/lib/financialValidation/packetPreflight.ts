import "server-only";

/**
 * Phase 55D — Committee Packet Preflight
 *
 * Checks financial validation state before packet generation.
 * Draft packets allowed when memo-safe; final requires decision-safe.
 */

import { buildCommitteeFinancialValidationSummary } from "./buildCommitteeFinancialValidationSummary";

export type PacketMode = "draft" | "final";

export type PacketPreflightResult = {
  allowed: boolean;
  mode: PacketMode;
  blockers: string[];
  warnings: string[];
  financialValidation: {
    status: string;
    memoSafe: boolean;
    decisionSafe: boolean;
    narrative: string;
  };
};

/**
 * Run preflight check for committee packet generation.
 */
export async function runPacketPreflight(
  dealId: string,
  requestedMode: PacketMode,
): Promise<PacketPreflightResult> {
  const summary = await buildCommitteeFinancialValidationSummary(dealId);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (requestedMode === "final") {
    if (!summary.decisionSafe) {
      blockers.push("Financial validation is not decision-safe — resolve open items before generating final packet");
    }
    if (summary.staleReasons.length > 0) {
      blockers.push("Financial snapshot is stale — rebuild before generating final packet");
    }
  }

  if (requestedMode === "draft") {
    if (!summary.memoSafe) {
      blockers.push("Financial validation is not memo-safe — cannot generate even a draft packet");
    }
    if (!summary.decisionSafe) {
      warnings.push("This is a DRAFT packet — financial validation is not yet decision-safe");
    }
  }

  if (summary.unresolvedConflictCount > 0) {
    warnings.push(`${summary.unresolvedConflictCount} unresolved financial conflict(s)`);
  }
  if (summary.openFollowUpCount > 0) {
    warnings.push(`${summary.openFollowUpCount} low-confidence follow-up item(s) remain`);
  }

  return {
    allowed: blockers.length === 0,
    mode: requestedMode,
    blockers,
    warnings,
    financialValidation: {
      status: summary.status,
      memoSafe: summary.memoSafe,
      decisionSafe: summary.decisionSafe,
      narrative: summary.narrative,
    },
  };
}
