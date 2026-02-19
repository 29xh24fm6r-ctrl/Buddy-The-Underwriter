/**
 * Buddy Institutional Document Matching Engine v1 — Document Identity Builder
 *
 * Pure function. No server-only, no DB, no IO.
 *
 * Consolidates signals from Spine v2 classification + gatekeeper into a
 * single DocumentIdentity for the constraint-based matching engine.
 */

import type {
  DocumentIdentity,
  ClassificationAuthority,
  ClassificationEvidenceItem,
  PeriodInfo,
  EntityInfo,
} from "./types";

// ---------------------------------------------------------------------------
// Input types (loosely typed to avoid tight coupling)
// ---------------------------------------------------------------------------

export type SpineSignals = {
  docType: string;
  confidence: number;
  spineTier: string; // "tier1_anchor" | "tier2_structural" | "tier3_llm" | "fallback"
  taxYear: number | null;
  entityType: "business" | "personal" | null;
  formNumbers: string[] | null;
  evidence: Array<{
    type: string;
    anchorId: string;
    matchedText: string;
    confidence: number;
  }>;
};

export type GatekeeperSignals = {
  docType: string; // GatekeeperDocType
  confidence: number;
  taxYear: number | null;
  formNumbers: string[];
  effectiveDocType: string; // After mapGatekeeperDocTypeToEffectiveDocType
};

export type BuildIdentityParams = {
  documentId: string;
  spine: SpineSignals | null;
  gatekeeper: GatekeeperSignals | null;
  matchSource?: "manual" | null;
  /** v1.1: Period extraction result — null = not extracted. */
  period?: PeriodInfo | null;
  /** v1.1: Entity resolution result — null = not resolved. */
  entity?: EntityInfo | null;
};

// ---------------------------------------------------------------------------
// Authority class resolution
// ---------------------------------------------------------------------------

function resolveAuthority(
  spine: SpineSignals | null,
  matchSource?: "manual" | null,
): ClassificationAuthority {
  if (matchSource === "manual") return "manual";

  if (!spine) return "probabilistic"; // gatekeeper-only = probabilistic

  switch (spine.spineTier) {
    case "tier1_anchor":
    case "tier2_structural":
      return "deterministic";
    case "tier3_llm":
      return "probabilistic";
    case "fallback":
    default:
      return "probabilistic";
  }
}

// ---------------------------------------------------------------------------
// Evidence consolidation
// ---------------------------------------------------------------------------

function consolidateEvidence(
  spine: SpineSignals | null,
  gatekeeper: GatekeeperSignals | null,
): ClassificationEvidenceItem[] {
  const items: ClassificationEvidenceItem[] = [];

  // Spine evidence
  if (spine?.evidence) {
    for (const e of spine.evidence) {
      items.push({
        type: e.type as ClassificationEvidenceItem["type"],
        anchorId: e.anchorId,
        matchedText: e.matchedText,
        confidence: e.confidence,
      });
    }
  }

  // Gatekeeper evidence (synthesized)
  if (gatekeeper) {
    items.push({
      type: "gatekeeper_signal",
      anchorId: `gatekeeper:${gatekeeper.docType}`,
      matchedText: gatekeeper.docType,
      confidence: gatekeeper.confidence,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Form number dedup
// ---------------------------------------------------------------------------

function mergeFormNumbers(
  spine: SpineSignals | null,
  gatekeeper: GatekeeperSignals | null,
): string[] | null {
  const set = new Set<string>();

  if (spine?.formNumbers) {
    for (const f of spine.formNumbers) set.add(f);
  }
  if (gatekeeper?.formNumbers) {
    for (const f of gatekeeper.formNumbers) set.add(f);
  }

  return set.size > 0 ? [...set] : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a DocumentIdentity from spine + gatekeeper signals.
 *
 * Consolidation rules:
 * - effectiveDocType: gatekeeper.effectiveDocType > spine.docType
 * - taxYear: gatekeeper > spine (gatekeeper is more specific for tax returns)
 * - formNumbers: merged (deduplicated)
 * - entityType: spine > gatekeeper (spine has text-level evidence)
 * - confidence: from primary authority source
 * - evidence: concatenated from both
 */
export function buildDocumentIdentity(
  params: BuildIdentityParams,
): DocumentIdentity {
  const { documentId, spine, gatekeeper, matchSource } = params;

  const authority = resolveAuthority(spine, matchSource);

  // effectiveDocType: prefer gatekeeper (downstream routing authority)
  const effectiveDocType =
    gatekeeper?.effectiveDocType ?? spine?.docType ?? "OTHER";

  // rawDocType: the classifier's raw output
  const rawDocType = spine?.docType ?? gatekeeper?.docType ?? "OTHER";

  // taxYear: prefer gatekeeper (more specific for tax returns)
  const taxYear = gatekeeper?.taxYear ?? spine?.taxYear ?? null;

  // entityType: prefer spine (text-level evidence)
  const entityType = spine?.entityType ?? null;

  // confidence: from the primary signal source
  const confidence = gatekeeper?.confidence ?? spine?.confidence ?? 0;

  // formNumbers: merge from both
  const formNumbers = mergeFormNumbers(spine, gatekeeper);

  // evidence: concatenate
  const classificationEvidence = consolidateEvidence(spine, gatekeeper);

  return {
    documentId,
    effectiveDocType,
    rawDocType,
    taxYear,
    entityType,
    formNumbers,
    authority,
    confidence,
    classificationEvidence,
    period: params.period ?? null,
    entity: params.entity ?? null,
  };
}
