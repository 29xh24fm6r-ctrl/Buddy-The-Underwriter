/**
 * Identity Resolution v2.0.0 — Entity Pre-Binding
 *
 * Pure function. No server-only, no DB, no IO.
 *
 * Replaces the soft-skip entity constraint approach (v1.3.1) with authoritative
 * upstream entity pre-binding. Uses the DealEntityGraph to resolve entity
 * identity BEFORE the matching engine runs.
 *
 * Resolution strategy:
 *   1. Single-entity deal (graph.entities.length === 1) → pre-bind unconditionally
 *   2. Type-unique deal (1 entity of the document's entityType) → pre-bind by type
 *   3. Multi-entity, multi-type → delegate to standard 6-tier resolution
 *
 * Invariants:
 *   - Pre-bound resolution always has confidence = 1.0
 *   - Pre-bound resolution is NEVER ambiguous
 *   - Standard resolution preserves existing 6-tier guarantees
 *   - Strict contract: entityId === null ⇔ ambiguous === true (no other state)
 */

import type { DealEntityGraph, DealEntity, DealEntityRole } from "./buildDealEntityGraph";
import { mapCanonicalTypeToEntityType } from "./mapCanonicalTypeToEntityType";
import {
  resolveEntity,
  type EntityCandidate,
  type EntityTextSignals,
  type EntityResolution,
  type EntityResolutionTier,
  type EntityEvidence,
} from "../intake/identity/entityResolver";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const IDENTITY_RESOLUTION_VERSION = "v2.0.0" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extended tier types: original 6 tiers + 2 new pre-binding tiers. */
export type IdentityResolutionTierV2 =
  | "single_entity_prebind"
  | "type_unique_prebind"
  | EntityResolutionTier;

export type IdentityResolutionV2Result = {
  entityId: string | null;
  entityRole: string | null;
  confidence: number;
  ambiguous: boolean;
  tier: IdentityResolutionTierV2;
  evidence: EntityEvidence[];
  resolutionVersion: "v2.0.0";
  graphVersion: string;
  preBound: boolean;
};

export type ResolveIdentityV2Params = {
  graph: DealEntityGraph;
  documentEntityType: "business" | "personal" | null;
  textSignals: EntityTextSignals;
  candidates: EntityCandidate[];
};

/**
 * Resolve documentEntityType from a canonical doc type string.
 * Convenience for callers that have effectiveDocType but not entityType.
 */
export function resolveDocumentEntityTypeFromCanonical(
  canonicalType: string,
): "business" | "personal" | null {
  const mapped = mapCanonicalTypeToEntityType(canonicalType);
  if (!mapped) return null;
  return mapped === "PERSON" ? "personal" : "business";
}

// ---------------------------------------------------------------------------
// Role mapping: DealEntityGraph role → EntityCandidate role
// ---------------------------------------------------------------------------

const GRAPH_ROLE_TO_RESOLVER_ROLE: Record<DealEntityRole, string> = {
  BORROWER: "borrower",
  GUARANTOR: "guarantor",
  OPERATING_CO: "operating",
  HOLDCO: "holding",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPreBindResult(
  entity: DealEntity,
  tier: "single_entity_prebind" | "type_unique_prebind",
  graphVersion: string,
): IdentityResolutionV2Result {
  return {
    entityId: entity.entityId,
    entityRole: GRAPH_ROLE_TO_RESOLVER_ROLE[entity.role] ?? "borrower",
    confidence: 1.0,
    ambiguous: false,
    tier,
    evidence: [
      {
        signal: tier,
        matchedText: `entityId=${entity.entityId}, role=${entity.role}`,
        candidateId: entity.entityId,
        confidence: 1.0,
      },
    ],
    resolutionVersion: IDENTITY_RESOLUTION_VERSION,
    graphVersion,
    preBound: true,
  };
}

/**
 * Wrap legacy 6-tier result with strict contract enforcement.
 *
 * Invariant: entityId === null ⇔ ambiguous === true.
 * If the 6-tier resolver returns entityId=null with ambiguous=false (no match),
 * we upgrade to ambiguous=true. In a multi-entity graph context, inability to
 * resolve IS ambiguity — the document belongs to some entity but we can't
 * determine which.
 */
function wrapLegacyResult(
  resolution: EntityResolution,
  graphVersion: string,
): IdentityResolutionV2Result {
  // Strict contract enforcement: null entity → ambiguous
  const ambiguous =
    resolution.entityId === null ? true : resolution.ambiguous;

  return {
    entityId: resolution.entityId,
    entityRole: resolution.entityRole,
    confidence: resolution.confidence,
    ambiguous,
    tier: resolution.tier,
    evidence: resolution.evidence,
    resolutionVersion: IDENTITY_RESOLUTION_VERSION,
    graphVersion,
    preBound: false,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve entity identity using the DealEntityGraph + standard 6-tier resolution.
 *
 * Strategy:
 *   1. Single-entity deal → pre-bind (tier: "single_entity_prebind", confidence: 1.0)
 *   2. Type-unique: 1 entity matching document's entityType → pre-bind (tier: "type_unique_prebind")
 *   3. Otherwise → delegate to standard resolveEntity()
 *
 * @param params.graph - The deduplicated DealEntityGraph
 * @param params.documentEntityType - Document's classified entity type ("business" | "personal" | null)
 * @param params.textSignals - Document text signals for 6-tier resolution
 * @param params.candidates - EntityCandidate[] for 6-tier resolution
 */
export function resolveIdentityV2(
  params: ResolveIdentityV2Params,
): IdentityResolutionV2Result {
  const { graph, documentEntityType, textSignals, candidates } = params;

  // Strategy 1: Single-entity deal → pre-bind unconditionally
  if (graph.entities.length === 1) {
    return buildPreBindResult(
      graph.entities[0],
      "single_entity_prebind",
      graph.version,
    );
  }

  // Strategy 2: Type-unique — document has a known entityType and graph has
  // exactly 1 entity of that type → pre-bind by type.
  // Uses canonical mapper for authoritative doc-type → entity-type mapping.
  if (documentEntityType) {
    const matchingType =
      documentEntityType === "business" ? "BUSINESS" : "PERSON";
    const typeMatches = graph.entities.filter(
      (e) => e.entityType === matchingType,
    );
    if (typeMatches.length === 1) {
      return buildPreBindResult(
        typeMatches[0],
        "type_unique_prebind",
        graph.version,
      );
    }
  }

  // Strategy 3: Multi-entity, multi-type → standard 6-tier resolution
  const resolution = resolveEntity(textSignals, candidates, documentEntityType);
  return wrapLegacyResult(resolution, graph.version);
}
