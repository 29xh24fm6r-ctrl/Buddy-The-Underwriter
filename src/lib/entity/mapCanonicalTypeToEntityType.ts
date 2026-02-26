/**
 * Canonical Doc Type → Entity Type Mapping
 *
 * Pure function. No server-only, no DB, no IO.
 *
 * Single source of truth for mapping document canonical types to the entity
 * type they belong to. Used by identity pre-binding and entity-aware slot
 * generation to route documents to the correct entity.
 *
 * Invariant: every ENTITY_SCOPED_DOC_TYPE must have a mapping here.
 */

import type { DealEntityType } from "./buildDealEntityGraph";

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const CANONICAL_TYPE_TO_ENTITY_TYPE: Record<string, DealEntityType> = {
  // Personal documents → PERSON
  PERSONAL_TAX_RETURN: "PERSON",
  PERSONAL_FINANCIAL_STATEMENT: "PERSON",

  // Business documents → BUSINESS
  BUSINESS_TAX_RETURN: "BUSINESS",
  INCOME_STATEMENT: "BUSINESS",
  BALANCE_SHEET: "BUSINESS",

  // K-1 can appear for both, but is primarily a business schedule
  K1: "BUSINESS",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a canonical document type to the entity type it belongs to.
 * Returns null for document types that are not entity-scoped (e.g., SBA forms).
 */
export function mapCanonicalTypeToEntityType(
  canonicalType: string,
): DealEntityType | null {
  return CANONICAL_TYPE_TO_ENTITY_TYPE[canonicalType] ?? null;
}

/**
 * Map a canonical document type to the "business" | "personal" format
 * used by classification pipelines.
 * Returns null for non-entity-scoped types.
 */
export function mapCanonicalTypeToClassificationEntityType(
  canonicalType: string,
): "business" | "personal" | null {
  const entityType = CANONICAL_TYPE_TO_ENTITY_TYPE[canonicalType];
  if (!entityType) return null;
  return entityType === "PERSON" ? "personal" : "business";
}
