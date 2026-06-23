/**
 * Canonical type alias helpers — SPEC-PFS-CANONICAL-TYPE-ALIAS-1
 *
 * The classifier outputs "PFS" but several code paths check for
 * "PERSONAL_FINANCIAL_STATEMENT". Both values exist in the DB.
 * This module provides a single source of truth for alias resolution.
 */

export const PFS_CANONICAL_TYPES = new Set([
  "PFS",
  "PERSONAL_FINANCIAL_STATEMENT",
]);

export function isPfsDoc(canonicalType: string | null | undefined): boolean {
  return PFS_CANONICAL_TYPES.has(canonicalType ?? "");
}
