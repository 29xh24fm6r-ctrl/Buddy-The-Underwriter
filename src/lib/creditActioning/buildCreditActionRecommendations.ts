/**
 * Phase 55F — Credit Action Recommendation Builder
 *
 * Maps validated financial exceptions into concrete underwriting
 * action recommendations. Deterministic — no AI, no prompts.
 *
 * Pure function — accepts pre-fetched data.
 */

import type { FinancialException, OverrideInsight } from "@/lib/financialValidation/exception-types";
import type { CreditActionRecommendation, CreditActionType, ActionCategory, ProposedTerms } from "./credit-action-types";
import { scoreCreditActionPriority } from "./scoreCreditActionPriority";

type BuildInput = {
  dealId: string;
  exceptions: FinancialException[];
  overrideInsights: OverrideInsight[];
  isPreCommittee: boolean;
  isPostMemo: boolean;
};

/**
 * Build credit action recommendations from exception intelligence.
 */
export function buildCreditActionRecommendations(input: BuildInput): CreditActionRecommendation[] {
  const { dealId, exceptions, overrideInsights, isPreCommittee, isPostMemo } = input;
  const actions: CreditActionRecommendation[] = [];
  let counter = 0;

  // 1. Exception-driven actions
  for (const ex of exceptions) {
    const mapped = mapExceptionToAction(ex);
    if (!mapped) continue;

    const priority = scoreCreditActionPriority({
      actionType: mapped.actionType,
      severity: ex.severity,
      isPostMemo,
      isPreCommittee,
    });

    actions.push({
      id: `action-${++counter}`,
      dealId,
      sourceExceptionId: ex.id,
      actionType: mapped.actionType,
      category: ex.category as ActionCategory,
      severity: ex.severity,
      priority,
      recommendedText: mapped.recommendedText,
      rationale: ex.whyItMatters,
      committeeImpact: ex.committeeDisclosure,
      proposedTerms: mapped.proposedTerms,
      status: "proposed",
      evidence: {
        exceptionKind: ex.kind,
        factKey: ex.factKey,
        periodKey: ex.periodKey,
      },
    });
  }

  // 2. Override-driven actions
  for (const ov of overrideInsights) {
    if (!ov.material) continue;

    const actionType: CreditActionType = ov.direction === "aggressive"
      ? "pricing_review"
      : ov.requiresCommitteeDisclosure
        ? "committee_discussion_item"
        : "no_action";

    if (actionType === "no_action") continue;

    const priority = scoreCreditActionPriority({
      actionType,
      severity: ov.direction === "aggressive" ? "high" : "moderate",
      isPostMemo,
      isPreCommittee,
    });

    actions.push({
      id: `action-ov-${++counter}`,
      dealId,
      sourceExceptionId: null,
      actionType,
      category: "policy_proximity",
      severity: ov.direction === "aggressive" ? "high" : "moderate",
      priority,
      recommendedText: actionType === "pricing_review"
        ? `Review pricing for ${ov.factKey} — banker override is ${ov.direction} (${formatDelta(ov.deltaPct)})`
        : `Committee disclosure: ${ov.factKey} adjusted by banker (${ov.direction}, ${formatDelta(ov.deltaPct)})`,
      rationale: `Banker adjusted ${ov.factKey} from ${ov.buddyValue ?? "N/A"} to ${ov.bankerValue ?? "N/A"}. Direction: ${ov.direction}. Rationale quality: ${ov.rationaleQuality}.`,
      committeeImpact: ov.requiresCommitteeDisclosure
        ? `${ov.factKey} was materially adjusted (${ov.direction}) with ${ov.rationaleQuality} rationale support.`
        : null,
      proposedTerms: actionType === "pricing_review"
        ? { pricingAdjustmentBps: null }
        : {},
      status: "proposed",
      evidence: { factKey: ov.factKey, periodKey: ov.periodKey },
    });
  }

  // Sort: immediate first, then pre_committee, pre_close, post_close
  const ORDER: Record<string, number> = { immediate: 0, pre_committee: 1, pre_close: 2, post_close: 3 };
  actions.sort((a, b) => (ORDER[a.priority] ?? 4) - (ORDER[b.priority] ?? 4));

  return actions;
}

type MappedAction = {
  actionType: CreditActionType;
  recommendedText: string;
  proposedTerms: ProposedTerms;
};

function mapExceptionToAction(ex: FinancialException): MappedAction | null {
  const fact = ex.factKey?.replace(/_/g, " ") ?? "financial metric";

  switch (ex.kind) {
    case "stale_snapshot":
      return {
        actionType: "memo_regeneration_required",
        recommendedText: "Rebuild financial snapshot and regenerate credit memo to reflect latest evidence",
        proposedTerms: {},
      };

    case "material_change_after_memo":
      return {
        actionType: "memo_regeneration_required",
        recommendedText: `Material change in ${fact} after memo generation — regenerate memo`,
        proposedTerms: {},
      };

    case "missing_critical_metric":
      return {
        actionType: "request_supporting_document",
        recommendedText: `Request documentation to support ${fact}`,
        proposedTerms: { conditionText: `Borrower to provide documentation supporting ${fact}` },
      };

    case "unresolved_conflict":
      if (ex.severity === "critical" || ex.severity === "high") {
        return {
          actionType: "committee_discussion_item",
          recommendedText: `Unresolved ${fact} conflict requires committee discussion`,
          proposedTerms: {},
        };
      }
      return {
        actionType: "add_condition",
        recommendedText: `Resolve ${fact} discrepancy prior to closing`,
        proposedTerms: { conditionText: `Borrower to provide reconciliation of ${fact} discrepancy` },
      };

    case "low_confidence_required_fact":
      return {
        actionType: "request_supporting_document",
        recommendedText: `Request clearer documentation for ${fact} (low extraction confidence)`,
        proposedTerms: {},
      };

    case "banker_override":
      if (ex.severity === "critical" || ex.severity === "high") {
        return {
          actionType: "pricing_review",
          recommendedText: `Review pricing impact of banker adjustment to ${fact}`,
          proposedTerms: { pricingAdjustmentBps: null },
        };
      }
      return null; // Low/moderate overrides → disclosure only, handled by 55E

    case "manual_provided_value":
      return {
        actionType: "request_supporting_document",
        recommendedText: `Obtain uploaded documentation to support manually entered ${fact}`,
        proposedTerms: { conditionText: `Borrower to provide source documentation for ${fact}` },
      };

    case "deferred_follow_up":
      if (ex.category === "debt_service" || ex.category === "cash_flow" || ex.category === "leverage") {
        return {
          actionType: "add_covenant",
          recommendedText: `Add ${fact} monitoring covenant for ongoing compliance`,
          proposedTerms: {
            covenantMetric: fact,
            testingFrequency: "annually",
          },
        };
      }
      return {
        actionType: "add_reporting_requirement",
        recommendedText: `Add reporting requirement for ${fact} monitoring`,
        proposedTerms: { reportingRequirement: `Borrower to provide ${fact} reporting` },
      };
  }
}

function formatDelta(pct: number | null): string {
  if (pct == null) return "N/A";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}
