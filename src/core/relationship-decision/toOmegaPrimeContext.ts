// Pure function. No DB. No side effects. No network.
import type {
  RelationshipDecisionEnvelope,
  OmegaPrimeDecisionContext,
} from "./types";
import { KERNEL_VERSION } from "./computeDecisionEnvelope";

/**
 * Convert a canonical decision envelope into an Omega Prime context object.
 * Omega reads this; it never mutates canonical state.
 */
export function toOmegaPrimeContext(
  envelope: RelationshipDecisionEnvelope,
): OmegaPrimeDecisionContext {
  return {
    relationshipId: envelope.relationshipId,
    canonicalPrimaryAction: envelope.primaryAction,
    systemTier: envelope.systemTier,
    whyNow: envelope.whyNow,
    whyNotElse: envelope.whyNotElse,
    queueReasons: envelope.queueReasons,
    evidenceSummary: {
      totalCount: envelope.evidence.length,
      policyRelevantCount: envelope.evidence.filter((e) => e.policyRelevant).length,
      staleCount: envelope.evidence.filter((e) => e.freshnessClass === "stale").length,
    },
    secondaryOpportunities: envelope.secondaryActions,
    conflictNotes: envelope.conflicts.map((c) => c.description),
    kernelVersion: KERNEL_VERSION,
  };
}
