/**
 * Buddy Institutional Document Matching Engine v1 — Confidence Gate
 *
 * Pure function. No server-only, no DB, no IO.
 *
 * Authority-class-aware confidence thresholds:
 *   deterministic ≥ 0.90
 *   probabilistic ≥ 0.85
 *   manual → always
 */

import type {
  DocumentIdentity,
  SlotSnapshot,
  ConfidenceGateResult,
} from "./types";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Minimum confidence for deterministic authority (Tier 1/2 anchors). */
export const DETERMINISTIC_THRESHOLD = 0.90;

/** Minimum confidence for probabilistic authority (Tier 3 LLM / gatekeeper). */
export const PROBABILISTIC_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine if a document's classification is confident enough for auto-attachment.
 *
 * Rules:
 * 1. Manual authority → always auto_attach
 * 2. No evidence items → route_to_review (regardless of authority)
 * 3. Below threshold for authority class → route_to_review
 * 4. All pass → auto_attach
 */
export function shouldAutoAttach(
  identity: DocumentIdentity,
  thresholdOverride?: number,
): ConfidenceGateResult {
  // Manual authority always attaches
  if (identity.authority === "manual") {
    return {
      decision: "auto_attach",
      reason: "Manual override — always auto-attach",
    };
  }

  // No evidence = no match
  if (identity.classificationEvidence.length === 0) {
    return {
      decision: "route_to_review",
      reason: "No classification evidence — cannot auto-attach",
    };
  }

  // Authority-class-aware thresholds (v1.2: adaptive override takes precedence)
  const threshold = thresholdOverride
    ?? (identity.authority === "deterministic"
      ? DETERMINISTIC_THRESHOLD
      : PROBABILISTIC_THRESHOLD);

  if (identity.confidence < threshold) {
    return {
      decision: "route_to_review",
      reason: `Confidence ${identity.confidence} below ${identity.authority} threshold ${threshold}`,
    };
  }

  return {
    decision: "auto_attach",
    reason: `Confidence ${identity.confidence} meets ${identity.authority} threshold ${threshold}`,
  };
}

// ---------------------------------------------------------------------------
// v1.4: Entity ambiguity gate (unconditional)
// ---------------------------------------------------------------------------

/**
 * If the document has ambiguous entity resolution, ALWAYS route to review.
 * Never guess between entities. No slot check needed — ambiguity is
 * authoritative regardless of slot configuration.
 *
 * v1.4.0: Removed conditional slot check. Ambiguous = review, always.
 * Returns null when no entity ambiguity issue (caller proceeds normally).
 */
export function checkEntityAmbiguity(
  identity: DocumentIdentity,
  _slots: SlotSnapshot[],
): ConfidenceGateResult | null {
  if (!identity.entity?.ambiguous) return null;

  return {
    decision: "route_to_review",
    reason: "Identity ambiguous — always routes to review",
  };
}
