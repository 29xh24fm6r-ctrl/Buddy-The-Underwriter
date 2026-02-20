/**
 * Phase E3 — Logical Document Identity Key
 *
 * Pure module — no server-only, no DB. Safe for CI guard imports.
 *
 * A logical key uniquely identifies a document's purpose within a deal:
 *   canonical_type | tax_year | entity_id
 *
 * At most one ACTIVE document may hold a given logical key (enforced by
 * partial unique index `uniq_active_logical_key`).
 *
 * Rules (evaluated in order, first exit wins):
 * 1. canonicalType is NULL → NULL (unclassified)
 * 2. qualityStatus !== "PASSED" → NULL (quality-failed docs don't participate)
 * 3. Entity-scoped type (PTR/PFS/BTR) AND entityId is NULL → NULL (identity unresolved)
 * 4. Otherwise → "canonical_type|taxYear_or_NA|entityId_or_NA"
 *
 * NULL logical_key = identity unresolved during classification (fail-open).
 * But fail-closed at confirmation — see confirm route entity ambiguity gate.
 */

import { ENTITY_SCOPED_DOC_TYPES } from "@/lib/intake/identity/entityScopedDocTypes";

export const SUPERSESSION_VERSION = "supersession_v1" as const;

export function computeLogicalKey(input: {
  canonicalType: string | null;
  taxYear: number | null;
  qualityStatus: string | null;
  entityId: string | null;
}): string | null {
  const { canonicalType, taxYear, qualityStatus, entityId } = input;

  // Rule 1: unclassified
  if (canonicalType == null) return null;

  // Rule 2: quality-failed docs don't participate in supersession
  if (qualityStatus !== "PASSED") return null;

  // Rule 3: entity-scoped types require resolved entity
  if (ENTITY_SCOPED_DOC_TYPES.has(canonicalType) && entityId == null) {
    return null;
  }

  // Rule 4: build deterministic key
  const yearPart = taxYear != null ? String(taxYear) : "NA";
  const entityPart = entityId != null ? entityId : "NA";

  return `${canonicalType}|${yearPart}|${entityPart}`;
}
