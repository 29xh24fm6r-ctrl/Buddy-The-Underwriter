/**
 * Phase 55G — Deal Next Step Engine
 *
 * Deterministic routing: tells the banker what to do next.
 * Pure function — accepts pre-fetched state.
 */

export type DealNextStep = {
  label: string;
  href: string;
  reason: string;
  priority: "immediate" | "soon" | "later";
  domain: "borrower" | "documents" | "underwrite" | "pricing" | "memo" | "committee" | "servicing";
};

type NextStepInput = {
  dealId: string;
  stage: string | null;
  blockers: string[];
  unexecutedActionCount: number;
  pendingBorrowerRequests: number;
  pricingReviewOpen: boolean;
  structureReviewOpen: boolean;
  memoRegenerationRequired: boolean;
  packetRegenerationRequired: boolean;
  committeeDiscussionOpen: number;
  covenantSeedsCount: number;
  monitoringSeedsCount: number;
  financialValidationBlocked: boolean;
  // Phase 56A: Builder integration
  builderPartiesIncomplete?: boolean;
  builderCollateralMissing?: boolean;
  builderStoryIncomplete?: boolean;
  builderDocsMissing?: boolean;
};

/**
 * Determine the banker's next best action for a deal.
 */
export function getDealNextStep(input: NextStepInput): DealNextStep {
  const { dealId } = input;

  // 1. Immediate: financial validation blocking committee
  if (input.financialValidationBlocked) {
    return {
      label: "Resolve Financial Validation",
      href: `/deals/${dealId}/financial-validation`,
      reason: "Financial validation is blocking committee readiness",
      priority: "immediate",
      domain: "underwrite",
    };
  }

  // 2. Immediate: memo regeneration
  if (input.memoRegenerationRequired) {
    return {
      label: "Regenerate Credit Memo",
      href: `/credit-memo/${dealId}/canonical`,
      reason: "Credit memo is stale or requires regeneration",
      priority: "immediate",
      domain: "memo",
    };
  }

  // 3. Immediate: packet regeneration
  if (input.packetRegenerationRequired) {
    return {
      label: "Regenerate Committee Packet",
      href: `/deals/${dealId}/cockpit?tab=underwriting`,
      reason: "Committee packet requires regeneration",
      priority: "immediate",
      domain: "committee",
    };
  }

  // 4. Soon: unexecuted accepted actions
  if (input.unexecutedActionCount > 0) {
    return {
      label: `Execute ${input.unexecutedActionCount} Credit Action${input.unexecutedActionCount !== 1 ? "s" : ""}`,
      href: `/deals/${dealId}/cockpit?tab=underwriting`,
      reason: "Accepted credit actions need to be converted into deal records",
      priority: "soon",
      domain: "underwrite",
    };
  }

  // 5. Soon: pricing review
  if (input.pricingReviewOpen) {
    return {
      label: "Complete Pricing Review",
      href: `/deals/${dealId}/pricing`,
      reason: "Pricing review was recommended and is not yet completed",
      priority: "soon",
      domain: "pricing",
    };
  }

  // 6. Soon: structure review
  if (input.structureReviewOpen) {
    return {
      label: "Complete Structure Review",
      href: `/deals/${dealId}/pricing`,
      reason: "Structure review was recommended and is not yet completed",
      priority: "soon",
      domain: "pricing",
    };
  }

  // 7. Soon: committee discussion items
  if (input.committeeDiscussionOpen > 0) {
    return {
      label: "Review Committee Discussion Items",
      href: `/credit-memo/${dealId}/canonical`,
      reason: `${input.committeeDiscussionOpen} committee discussion item(s) need resolution`,
      priority: "soon",
      domain: "committee",
    };
  }

  // 8. Soon: pending borrower requests
  if (input.pendingBorrowerRequests > 0) {
    return {
      label: "Follow Up on Borrower Requests",
      href: `/deals/${dealId}/conditions`,
      reason: `${input.pendingBorrowerRequests} borrower request(s) are pending`,
      priority: "soon",
      domain: "borrower",
    };
  }

  // 8.5. Phase 56A: Builder-aware routing
  if (input.builderPartiesIncomplete) {
    return {
      label: "Complete Deal Parties",
      href: `/deals/${dealId}/cockpit?tab=setup`,
      reason: "Required participation roles are incomplete in Builder",
      priority: "soon",
      domain: "underwrite",
    };
  }
  if (input.builderCollateralMissing) {
    return {
      label: "Configure Collateral",
      href: `/deals/${dealId}/cockpit?tab=setup`,
      reason: "Collateral configuration is required for this deal structure",
      priority: "soon",
      domain: "underwrite",
    };
  }
  if (input.builderDocsMissing) {
    return {
      label: "Request Missing Documents",
      href: `/deals/${dealId}/cockpit?tab=documents`,
      reason: "Required documents are missing for one or more entities",
      priority: "soon",
      domain: "documents",
    };
  }
  if (input.builderStoryIncomplete) {
    return {
      label: "Complete Deal Story",
      href: `/deals/${dealId}/cockpit?tab=story`,
      reason: "Deal narrative needs completion for credit memo",
      priority: "later",
      domain: "underwrite",
    };
  }

  // 9. Later: covenant/monitoring seeds
  if (input.covenantSeedsCount > 0 || input.monitoringSeedsCount > 0) {
    return {
      label: "Configure Servicing Requirements",
      href: `/deals/${dealId}/cockpit?tab=underwriting`,
      reason: "Covenant and monitoring requirements need to be finalized",
      priority: "later",
      domain: "servicing",
    };
  }

  // 10. Default: go to cockpit
  if (input.blockers.length > 0) {
    return {
      label: "Review Deal Blockers",
      href: `/deals/${dealId}/cockpit`,
      reason: `${input.blockers.length} blocker(s) need attention`,
      priority: "soon",
      domain: "underwrite",
    };
  }

  return {
    label: "View Deal Cockpit",
    href: `/deals/${dealId}/cockpit`,
    reason: "No immediate actions required",
    priority: "later",
    domain: "underwrite",
  };
}
