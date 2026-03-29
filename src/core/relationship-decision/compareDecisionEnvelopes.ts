// Pure function. No DB. No side effects. No network.
import type { RelationshipDecisionEnvelope } from "./types";

/**
 * Compare two decision envelopes to determine if a material change occurred.
 * Returns true if the decision has changed in a way that warrants a transition event.
 */
export function compareDecisionEnvelopes(
  prev: RelationshipDecisionEnvelope | null,
  next: RelationshipDecisionEnvelope,
): {
  changed: boolean;
  changes: string[];
} {
  if (!prev) return { changed: true, changes: ["initial_decision"] };

  const changes: string[] = [];

  if (prev.systemTier !== next.systemTier) {
    changes.push(`tier_changed:${prev.systemTier}→${next.systemTier}`);
  }

  if (prev.primaryAction?.code !== next.primaryAction?.code) {
    changes.push(
      `primary_action_changed:${prev.primaryAction?.code ?? "none"}→${next.primaryAction?.code ?? "none"}`,
    );
  }

  if (prev.actionability.isActionableNow !== next.actionability.isActionableNow) {
    changes.push(`actionability_changed:${prev.actionability.isActionableNow}→${next.actionability.isActionableNow}`);
  }

  if (prev.actionability.actorType !== next.actionability.actorType) {
    changes.push(`actor_changed:${prev.actionability.actorType}→${next.actionability.actorType}`);
  }

  if (prev.conflicts.length !== next.conflicts.length) {
    changes.push(`conflict_count_changed:${prev.conflicts.length}→${next.conflicts.length}`);
  }

  return { changed: changes.length > 0, changes };
}
