// Pure function. No DB. No side effects. No network.
import type {
  PortfolioAction,
  PortfolioSignal,
  RankedRelationship,
  PortfolioScope,
} from "./types";

/**
 * Derive portfolio-level actions from signals and ranked relationships.
 * Max 5 actions, sorted by severity/impact.
 */
export function buildPortfolioActionability(
  scope: PortfolioScope,
  ranked: RankedRelationship[],
  signals: PortfolioSignal[],
): PortfolioAction[] {
  const actions: PortfolioAction[] = [];

  // High-risk cluster review
  const highRiskSignals = signals.filter(
    (s) => s.severity === "critical" || s.severity === "high",
  );
  for (const sig of highRiskSignals) {
    actions.push({
      actionCode: "review_high_risk_cluster",
      scope,
      relationshipIds: sig.relationshipIds,
      explanation: sig.explanation,
      actionability: {
        isActionableNow: true,
        actorType: "team_lead",
        dueAt: null,
        closureCondition: "All cluster relationships reviewed",
        evidenceIds: sig.evidenceIds,
        deeplink: "/portfolio",
      },
    });
  }

  // Renewal wave
  const renewalSignal = signals.find((s) => s.type === "renewal_wave");
  if (renewalSignal) {
    actions.push({
      actionCode: "prioritize_renewals",
      scope,
      relationshipIds: renewalSignal.relationshipIds,
      explanation: renewalSignal.explanation,
      actionability: {
        isActionableNow: true,
        actorType: "team_lead",
        dueAt: null,
        closureCondition: "Renewal pipeline reviewed and prioritized",
        evidenceIds: renewalSignal.evidenceIds,
        deeplink: "/portfolio",
      },
    });
  }

  // Deposit runoff
  const depositSignal = signals.find((s) => s.type === "deposit_runoff_cluster");
  if (depositSignal) {
    actions.push({
      actionCode: "address_deposit_runoff",
      scope,
      relationshipIds: depositSignal.relationshipIds,
      explanation: depositSignal.explanation,
      actionability: {
        isActionableNow: true,
        actorType: "team_lead",
        dueAt: null,
        closureCondition: "Deposit retention strategy deployed",
        evidenceIds: depositSignal.evidenceIds,
        deeplink: "/portfolio",
      },
    });
  }

  // Banker focus rebalance (when top relationships are concentrated)
  const criticalCount = ranked.filter(
    (r) => r.systemTier === "integrity" || r.systemTier === "critical_distress",
  ).length;
  if (criticalCount >= 5) {
    actions.push({
      actionCode: "rebalance_banker_focus",
      scope,
      relationshipIds: ranked.slice(0, 5).map((r) => r.relationshipId),
      explanation: `${criticalCount} relationships require critical attention. Consider rebalancing workload.`,
      actionability: {
        isActionableNow: true,
        actorType: "credit_admin",
        dueAt: null,
        closureCondition: "Workload reviewed and assignments adjusted",
        evidenceIds: [],
        deeplink: "/portfolio",
      },
    });
  }

  // Growth cluster
  const growthSignal = signals.find((s) => s.type === "growth_opportunity_cluster");
  if (growthSignal) {
    actions.push({
      actionCode: "advance_growth_cluster",
      scope,
      relationshipIds: growthSignal.relationshipIds,
      explanation: growthSignal.explanation,
      actionability: {
        isActionableNow: true,
        actorType: "banker",
        dueAt: null,
        closureCondition: "Growth opportunities reviewed",
        evidenceIds: growthSignal.evidenceIds,
        deeplink: "/portfolio",
      },
    });
  }

  return actions.slice(0, 5);
}
