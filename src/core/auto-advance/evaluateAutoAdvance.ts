/**
 * Phase 65G — Auto-Advance Evaluation
 *
 * Determines whether a deal is eligible for deterministic stage advancement.
 * Pure function — no DB, no side effects.
 */

import type { AutoAdvanceEvaluation } from "@/core/sla/types";
import type { BuddyNextAction } from "@/core/actions/types";
import { getAutoAdvanceRule } from "./autoAdvancePolicy";

export type AutoAdvanceInput = {
  canonicalStage: string;
  blockerCodes: string[];
  borrowerCampaignsComplete: boolean;
  nextActions: BuddyNextAction[];
};

export function evaluateAutoAdvance(
  input: AutoAdvanceInput,
): AutoAdvanceEvaluation {
  const rule = getAutoAdvanceRule(input.canonicalStage);

  // Terminal stages or no rule
  if (!rule) {
    return {
      eligible: false,
      fromStage: input.canonicalStage,
      toStage: null,
      triggerCode: null,
      reason: "No auto-advance rule exists for current stage.",
      evidence: {},
    };
  }

  // Check that all required-absent blockers are indeed absent
  const blockingBlockers = rule.requiredAbsentBlockers.filter((b) =>
    input.blockerCodes.includes(b),
  );

  if (blockingBlockers.length > 0) {
    return {
      eligible: false,
      fromStage: rule.fromStage,
      toStage: rule.toStage,
      triggerCode: rule.triggerCode,
      reason: `Blockers still present: ${blockingBlockers.join(", ")}`,
      evidence: {
        blockingBlockers,
        totalBlockers: input.blockerCodes.length,
      },
    };
  }

  // For borrower-campaign-triggered advances, check campaigns are done
  if (
    rule.triggerCode === "borrower_campaigns_complete" &&
    !input.borrowerCampaignsComplete
  ) {
    return {
      eligible: false,
      fromStage: rule.fromStage,
      toStage: rule.toStage,
      triggerCode: rule.triggerCode,
      reason: "Borrower campaigns are not yet complete.",
      evidence: { borrowerCampaignsComplete: false },
    };
  }

  return {
    eligible: true,
    fromStage: rule.fromStage,
    toStage: rule.toStage,
    triggerCode: rule.triggerCode,
    reason: rule.description,
    evidence: {
      blockerCount: input.blockerCodes.length,
      blockingBlockers: [],
      borrowerCampaignsComplete: input.borrowerCampaignsComplete,
    },
  };
}
