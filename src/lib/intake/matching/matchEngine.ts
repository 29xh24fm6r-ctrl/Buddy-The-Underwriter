/**
 * Buddy Institutional Document Matching Engine v1 — Match Orchestrator
 *
 * Pure function. No server-only, no DB, no IO.
 *
 * Algorithm:
 *   1. Confidence gate → if review, return routed_to_review
 *   2. For each slot: negative rules → positive constraints → collect valid
 *   3. Disambiguation: 0 → no_match, 1 → auto_attached, >1 → routed_to_review
 *
 * No scoring. No sort-order preference. No heuristic selection.
 * Ties escalate to review. Never silent pick.
 */

import { shouldAutoAttach, checkEntityAmbiguity } from "./confidenceGate";
import { evaluateConstraints } from "./constraints";
import { evaluateNegativeRules } from "./negativeRules";
import {
  MATCHING_ENGINE_VERSION,
  type DocumentIdentity,
  type SlotSnapshot,
  type MatchResult,
  type MatchEvidence,
  type ConstraintResult,
  type NegativeRuleResult,
} from "./types";
import { ENTITY_PRECISION_THRESHOLD } from "../identity/version";

// ---------------------------------------------------------------------------
// Evidence builder
// ---------------------------------------------------------------------------

function buildEvidence(
  identity: DocumentIdentity,
  constraintResults: ConstraintResult[],
  negativeRuleResults: NegativeRuleResult[],
  slotPolicyVersion: string,
): MatchEvidence {
  return {
    engineVersion: MATCHING_ENGINE_VERSION,
    authority: identity.authority,
    classificationConfidence: identity.confidence,
    constraintsSatisfied: constraintResults,
    negativeRulesEvaluated: negativeRuleResults,
    classificationEvidence: identity.classificationEvidence,
    slotPolicyVersion,
    matchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Match a document to a slot using constraint satisfaction.
 *
 * @param identity - Consolidated document identity
 * @param slots - Available slot snapshots
 * @param slotPolicyVersion - For evidence stamping (audit replay)
 * @returns MatchResult with decision, evidence, and reason
 */
export function matchDocumentToSlot(
  identity: DocumentIdentity,
  slots: SlotSnapshot[],
  slotPolicyVersion: string = "default",
): MatchResult {
  // ── Step 1: Confidence gate ─────────────────────────────────────────
  const gateResult = shouldAutoAttach(identity);

  if (gateResult.decision === "route_to_review") {
    return {
      decision: "routed_to_review",
      slotId: null,
      slotKey: null,
      confidence: identity.confidence,
      evidence: buildEvidence(identity, [], [], slotPolicyVersion),
      reason: gateResult.reason,
    };
  }

  // ── Step 1b: Entity ambiguity gate (v1.1) ──────────────────────────
  const entityGate = checkEntityAmbiguity(identity, slots);
  if (entityGate?.decision === "route_to_review") {
    return {
      decision: "routed_to_review",
      slotId: null,
      slotKey: null,
      confidence: identity.confidence,
      evidence: buildEvidence(identity, [], [], slotPolicyVersion),
      reason: entityGate.reason,
    };
  }

  // ── Step 2: Evaluate each slot ──────────────────────────────────────
  type Candidate = {
    slot: SlotSnapshot;
    constraints: ConstraintResult[];
    negativeRules: NegativeRuleResult[];
  };

  const candidates: Candidate[] = [];

  for (const slot of slots) {
    // 2a. Negative rules — any blocked = skip
    const negativeRules = evaluateNegativeRules(identity, slot);
    if (negativeRules.some((r) => r.blocked)) {
      continue;
    }

    // 2b. Positive constraints — all must satisfy
    const constraints = evaluateConstraints(identity, slot);
    if (!constraints.every((r) => r.satisfied)) {
      continue;
    }

    candidates.push({ slot, constraints, negativeRules });
  }

  // ── Step 2.5: Entity-assisted precision ranking (Layer 2.2) ─────────────
  // Feature-flagged off by default (ENABLE_ENTITY_PRECISION=false).
  // When enabled with high-confidence entity resolution:
  //   Promotes entity-matched candidates to front of the list.
  //   Does not alter constraint evaluation.
  //   Does not allow mismatched entity slots to pass.
  //   Constraints remain authoritative — sort only reorders valid candidates.
  if (
    process.env.ENABLE_ENTITY_GRAPH === "true" &&
    process.env.ENABLE_ENTITY_PRECISION === "true" &&
    identity.entity?.entityId &&
    identity.entity.confidence >= ENTITY_PRECISION_THRESHOLD
  ) {
    candidates.sort((a, b) => {
      const aMatch = a.slot.requiredEntityId === identity.entity!.entityId;
      const bMatch = b.slot.requiredEntityId === identity.entity!.entityId;
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });
  }

  // ── Step 3: Disambiguation ──────────────────────────────────────────

  // 0 candidates → no_match
  if (candidates.length === 0) {
    return {
      decision: "no_match",
      slotId: null,
      slotKey: null,
      confidence: identity.confidence,
      evidence: buildEvidence(identity, [], [], slotPolicyVersion),
      reason: `No slot satisfies constraints for "${identity.effectiveDocType}"`,
    };
  }

  // 1 candidate → auto_attached
  if (candidates.length === 1) {
    const c = candidates[0];
    return {
      decision: "auto_attached",
      slotId: c.slot.slotId,
      slotKey: c.slot.slotKey,
      confidence: identity.confidence,
      evidence: buildEvidence(
        identity,
        c.constraints,
        c.negativeRules,
        slotPolicyVersion,
      ),
      reason: `Matched to slot "${c.slot.slotKey}"`,
    };
  }

  // >1 candidates → routed_to_review (ties escalate)
  return {
    decision: "routed_to_review",
    slotId: null,
    slotKey: null,
    confidence: identity.confidence,
    evidence: buildEvidence(identity, [], [], slotPolicyVersion),
    reason: `${candidates.length} candidate slots — tie escalated to review`,
  };
}
