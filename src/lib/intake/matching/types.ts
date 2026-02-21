/**
 * Buddy Institutional Document Matching Engine v1 — Types
 *
 * Pure module — no server-only, no DB, no IO.
 * All types for constraint-based slot matching.
 */

// ---------------------------------------------------------------------------
// Engine Version
// ---------------------------------------------------------------------------

/** Bump on any constraint/rule/threshold change. */
export const MATCHING_ENGINE_VERSION = "v1.2";

// ---------------------------------------------------------------------------
// Classification Authority
// ---------------------------------------------------------------------------

/**
 * Classification authority class — engine does NOT care which system produced it.
 *
 * - deterministic: Spine Tier 1/2 anchors, structural patterns
 * - probabilistic: Spine Tier 3 LLM, gatekeeper (OpenAI)
 * - manual: Human override
 */
export type ClassificationAuthority =
  | "deterministic"
  | "probabilistic"
  | "manual";

// ---------------------------------------------------------------------------
// Classification Evidence
// ---------------------------------------------------------------------------

export type ClassificationEvidenceItem = {
  type:
    | "form_match"
    | "keyword_match"
    | "structural_match"
    | "filename_match"
    | "docai_signal"
    | "gatekeeper_signal";
  anchorId: string;
  matchedText: string;
  confidence: number;
};

// ---------------------------------------------------------------------------
// Period Info (v1.1)
// ---------------------------------------------------------------------------

export type PeriodInfo = {
  periodStart: string | null;
  periodEnd: string | null;
  statementType:
    | "annual"
    | "ytd"
    | "interim"
    | "monthly"
    | "quarterly"
    | "ttm"
    | null;
  multiYear: boolean;
  taxYearConfidence: number;
};

// ---------------------------------------------------------------------------
// Entity Info (v1.1)
// ---------------------------------------------------------------------------

export type EntityInfo = {
  entityId: string | null;
  entityRole: string | null;
  confidence: number;
  ambiguous: boolean;
  /** v1.1 — resolution tier from EntityResolution (e.g. "ein_match", "name_exact", "none") */
  tier?: string | null;
};

// ---------------------------------------------------------------------------
// Document Identity
// ---------------------------------------------------------------------------

/** Consolidated identity from all classification signals. */
export type DocumentIdentity = {
  documentId: string;
  effectiveDocType: string;
  rawDocType: string;
  taxYear: number | null;
  entityType: "business" | "personal" | null;
  formNumbers: string[] | null;
  authority: ClassificationAuthority;
  confidence: number;
  classificationEvidence: ClassificationEvidenceItem[];
  /** v1.1: Period extraction — null = not extracted (backward compat). */
  period: PeriodInfo | null;
  /** v1.1: Entity resolution — null = not resolved (backward compat). */
  entity: EntityInfo | null;
};

// ---------------------------------------------------------------------------
// Slot Snapshot
// ---------------------------------------------------------------------------

/** Lightweight slot view for the pure matching engine. */
export type SlotSnapshot = {
  slotId: string;
  slotKey: string;
  slotGroup: string;
  requiredDocType: string;
  requiredTaxYear: number | null;
  status: string;
  sortOrder: number;
  /** Entity-aware routing — null = entity-agnostic (backward compatible). */
  requiredEntityId?: string | null;
  requiredEntityRole?: string | null;
};

// ---------------------------------------------------------------------------
// Constraint + Negative Rule Results
// ---------------------------------------------------------------------------

export type ConstraintResult = {
  satisfied: boolean;
  constraint: string;
  detail: string;
};

export type NegativeRuleResult = {
  blocked: boolean;
  ruleId: string;
  reason: string;
};

// ---------------------------------------------------------------------------
// Match Evidence
// ---------------------------------------------------------------------------

export type MatchEvidence = {
  engineVersion: string;
  authority: ClassificationAuthority;
  classificationConfidence: number;
  constraintsSatisfied: ConstraintResult[];
  negativeRulesEvaluated: NegativeRuleResult[];
  classificationEvidence: ClassificationEvidenceItem[];
  slotPolicyVersion: string;
  matchedAt: string;
  /** v1.2: Adaptive threshold audit trail — null when flag OFF or not applicable. */
  adaptiveThreshold?: {
    version: string;
    threshold: number;
    baseline: number;
    adapted: boolean;
    tier: string;
    band: string;
    calibrationSamples: number;
    calibrationOverrideRate: number | null;
  } | null;
};

// ---------------------------------------------------------------------------
// Match Decision + Result
// ---------------------------------------------------------------------------

export type MatchDecision = "auto_attached" | "routed_to_review" | "no_match";

export type MatchResult = {
  decision: MatchDecision;
  slotId: string | null;
  slotKey: string | null;
  confidence: number;
  evidence: MatchEvidence | null;
  reason: string;
};

// ---------------------------------------------------------------------------
// Confidence Gate
// ---------------------------------------------------------------------------

export type ConfidenceGateDecision = "auto_attach" | "route_to_review";

export type ConfidenceGateResult = {
  decision: ConfidenceGateDecision;
  reason: string;
};

// ---------------------------------------------------------------------------
// Match Config (v1.2 — adaptive thresholds)
// ---------------------------------------------------------------------------

/** Optional config passed to the pure matching engine. */
export type MatchConfig = {
  /** Override confidence threshold from adaptive resolver. */
  autoAttachThreshold?: number;
};
