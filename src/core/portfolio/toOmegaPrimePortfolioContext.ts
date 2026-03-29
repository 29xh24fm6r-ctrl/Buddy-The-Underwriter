// Pure function. No DB. No side effects. No network.
import type { PortfolioIntelligencePack, OmegaPrimePortfolioContext } from "./types";

/**
 * Convert portfolio pack to Omega Prime context.
 * Omega may narrate, explain, and present — but never override ranking or create signals.
 */
export function toOmegaPrimePortfolioContext(
  pack: PortfolioIntelligencePack,
): OmegaPrimePortfolioContext {
  return {
    bankId: pack.scope.bankId,
    topRelationships: pack.orderedRelationships.slice(0, 10).map((r) => ({
      relationshipId: r.relationshipId,
      tier: r.systemTier,
      primaryActionCode: r.primaryAction?.code ?? null,
      explanation: r.explanation,
    })),
    activeSignals: pack.signals.map((s) => ({
      type: s.type,
      severity: s.severity,
      relationshipCount: s.relationshipIds.length,
    })),
    summary: pack.summary,
    portfolioActions: pack.actions.map((a) => ({
      actionCode: a.actionCode,
      explanation: a.explanation,
    })),
  };
}
