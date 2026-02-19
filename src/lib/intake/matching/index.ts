/**
 * Buddy Institutional Document Matching Engine v1 — Barrel Export
 *
 * NOTE: runMatchForDocument is server-only. Import it directly:
 *   import { runMatchForDocument } from "@/lib/intake/matching/runMatch";
 *
 * This barrel re-exports types and pure functions only.
 */

// Types
export type {
  ClassificationAuthority,
  ClassificationEvidenceItem,
  DocumentIdentity,
  SlotSnapshot,
  ConstraintResult,
  NegativeRuleResult,
  MatchEvidence,
  MatchDecision,
  MatchResult,
  ConfidenceGateDecision,
  ConfidenceGateResult,
} from "./types";

// Constants
export { MATCHING_ENGINE_VERSION } from "./types";

// Pure functions
export { buildDocumentIdentity } from "./identity";
export { evaluateConstraints } from "./constraints";
export { evaluateNegativeRules, NEGATIVE_RULE_COUNT } from "./negativeRules";
export { shouldAutoAttach } from "./confidenceGate";
export { matchDocumentToSlot } from "./matchEngine";
