/**
 * Confidence Gate — Phase 4
 *
 * Pure function. Decides whether Tier 1/Tier 2 result is accepted
 * or if classification should escalate to Tier 3 LLM.
 *
 * Rules:
 * 1. Tier 1 matched → accept (always authoritative)
 * 2. Tier 2 matched AND confidence ≥ 0.80 → accept
 * 3. Else → escalate to Tier 3
 * 4. Low confidence (< 0.65) never auto-fills slots (enforced in orchestrator)
 */

import type { Tier1Result, Tier2Result, GateDecision } from "./types";

/** Minimum Tier 2 confidence to accept without LLM escalation */
const TIER2_ACCEPT_THRESHOLD = 0.80;

/**
 * Apply confidence gate to Tier 1 and Tier 2 results.
 *
 * Tier 1 always wins if matched.
 * Tier 2 accepted only if confidence ≥ 0.80.
 * Otherwise escalate to Tier 3 LLM.
 */
export function applyConfidenceGate(
  tier1: Tier1Result,
  tier2: Tier2Result,
): GateDecision {
  // Tier 1 is always authoritative
  if (tier1.matched) {
    return {
      accepted: true,
      source: "tier1",
      docType: tier1.docType,
      confidence: tier1.confidence,
      evidence: tier1.evidence,
      formNumbers: tier1.formNumbers,
      taxYear: tier1.taxYear,
      entityType: tier1.entityType,
    };
  }

  // Tier 2 accepted if confidence meets threshold
  if (tier2.matched && tier2.confidence >= TIER2_ACCEPT_THRESHOLD) {
    return {
      accepted: true,
      source: "tier2",
      docType: tier2.docType,
      confidence: tier2.confidence,
      evidence: tier2.evidence,
      formNumbers: null,
      taxYear: null,
      entityType: null,
    };
  }

  // Escalate to Tier 3 LLM
  return {
    accepted: false,
    source: "escalate_to_tier3",
    docType: null,
    confidence: 0,
    evidence: [],
    formNumbers: null,
    taxYear: null,
    entityType: null,
  };
}
