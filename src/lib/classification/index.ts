/**
 * Buddy Institutional Classification Spine v2 — Barrel Export
 *
 * NOTE: classifyDocumentSpine is server-only. Import it directly:
 *   import { classifyDocumentSpine } from "@/lib/classification/classifyDocumentSpine";
 *
 * This barrel re-exports types and pure functions only.
 */

// Types
export type {
  DocumentType,
  ClassificationTier,
  DocAiSignals,
  SpineClassificationResult,
  SpineClassificationTier,
  EvidenceItem,
  NormalizedDocument,
  Tier1Result,
  Tier2Result,
  Tier3Result,
  GateDecision,
  AnchorRule,
} from "./types";

// Schema version
export { CLASSIFICATION_SCHEMA_VERSION } from "./types";

// Pure functions (safe for any context)
export { normalizeDocument } from "./normalizeDocument";
export { runTier1Anchors } from "./tier1Anchors";
export { runTier2Structural } from "./tier2Structural";
export { applyConfidenceGate } from "./confidenceGate";
export { extractTaxYear, extractFormNumbers, extractDetectedYears } from "./textUtils";
