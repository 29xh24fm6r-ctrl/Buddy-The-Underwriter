/**
 * Buddy Institutional Classification Spine v2
 *
 * All types for the deterministic-first classification pipeline.
 * Pure module — no server-only, no DB, no API.
 */

// Re-export DocumentType from the existing classifier for downstream compat
export type { DocumentType } from "@/lib/artifacts/classifyDocument";
export type { ClassificationTier, DocAiSignals } from "@/lib/artifacts/classifyDocument";

// ---------------------------------------------------------------------------
// Schema Version
// ---------------------------------------------------------------------------

/** Bump on any anchor/pattern/prompt change. No silent behavior shifts. */
export const CLASSIFICATION_SCHEMA_VERSION = "v2.1";

// ---------------------------------------------------------------------------
// Spine Classification Tier
// ---------------------------------------------------------------------------

export type SpineClassificationTier =
  | "tier1_anchor"
  | "tier2_structural"
  | "tier3_llm"
  | "fallback";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type EvidenceItem = {
  type:
    | "form_match"
    | "keyword_match"
    | "structural_match"
    | "filename_match"
    | "docai_signal";
  anchorId: string;
  matchedText: string;
  confidence: number;
};

// ---------------------------------------------------------------------------
// Normalized Document
// ---------------------------------------------------------------------------

export type NormalizedDocument = {
  artifactId: string;
  filename: string;
  mimeType: string | null;
  pageCount: number;
  firstPageText: string;       // ~3000 chars
  firstTwoPagesText: string;   // ~6000 chars
  fullText: string;
  detectedYears: number[];
  hasTableLikeStructure: boolean;
};

// ---------------------------------------------------------------------------
// Anchor Rule (Tier 1)
// ---------------------------------------------------------------------------

export type AnchorRule = {
  anchorId: string;
  pattern: RegExp;
  docType: string; // DocumentType — string to avoid circular import
  confidence: number; // 0.90–0.99
  entityType: "business" | "personal" | null;
  formNumber: string | null;
  /** Optional secondary patterns — all must match for structural anchors */
  secondaryPatterns?: RegExp[];
  /** Minimum number of secondary patterns that must match (default: all) */
  secondaryMinMatch?: number;
};

// ---------------------------------------------------------------------------
// Tier 1 Result
// ---------------------------------------------------------------------------

export type Tier1Result = {
  matched: boolean;
  docType: string | null; // DocumentType
  confidence: number;
  anchorId: string | null;
  evidence: EvidenceItem[];
  formNumbers: string[] | null;
  taxYear: number | null;
  entityType: "business" | "personal" | null;
};

// ---------------------------------------------------------------------------
// Tier 2 Result
// ---------------------------------------------------------------------------

export type Tier2Result = {
  matched: boolean;
  docType: string | null; // DocumentType
  confidence: number;
  patternId: string | null;
  evidence: EvidenceItem[];
};

// ---------------------------------------------------------------------------
// Confidence Gate Decision
// ---------------------------------------------------------------------------

export type GateDecision = {
  accepted: boolean;
  source: "tier1" | "tier2" | "escalate_to_tier3";
  docType: string | null;
  confidence: number;
  evidence: EvidenceItem[];
  formNumbers: string[] | null;
  taxYear: number | null;
  entityType: "business" | "personal" | null;
};

// ---------------------------------------------------------------------------
// Tier 3 Result
// ---------------------------------------------------------------------------

export type Tier3Result = {
  matched: boolean;
  docType: string; // DocumentType
  confidence: number;
  reason: string;
  confusionCandidates: string[];
  evidence: EvidenceItem[];
  taxYear: number | null;
  entityName: string | null;
  entityType: "business" | "personal" | null;
  formNumbers: string[] | null;
  issuer: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  model: string;
};

// ---------------------------------------------------------------------------
// Spine Classification Result (superset of ClassificationResult)
// ---------------------------------------------------------------------------

/**
 * Drop-in compatible with ClassificationResult from classifyDocument.ts.
 * All existing fields preserved. New fields added for spine traceability.
 */
export type SpineClassificationResult = {
  // --- Existing ClassificationResult fields (drop-in compat) ---
  docType: string; // DocumentType
  confidence: number;
  reason: string;
  taxYear: number | null;
  entityName: string | null;
  entityType: "business" | "personal" | null;
  proposedDealName: string | null;
  proposedDealNameSource: string | null;
  rawExtraction: Record<string, unknown>;
  formNumbers: string[] | null;
  issuer: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  tier: string; // ClassificationTier — maps for compat
  model: string;
  // --- Spine-specific fields ---
  spineTier: SpineClassificationTier;
  spineVersion: string;
  evidence: EvidenceItem[];
  confusionCandidates?: string[];
};
