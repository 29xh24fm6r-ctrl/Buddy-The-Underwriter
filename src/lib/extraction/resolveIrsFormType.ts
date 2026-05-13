/**
 * SPEC-EXTRACT-VALIDATOR-WIRE-1 (rev 2) §1 — resolver from doc row to IRS form type.
 *
 * The post-extraction IRS identity validator needs to know which form spec
 * to apply. Today the classifier writes generic canonical_type values like
 * "BUSINESS_TAX_RETURN" that the old DOC_TYPE_TO_IRS_FORM map did not handle.
 * The form number is already persisted on deal_documents.ai_form_numbers
 * (populated by Tier 1 anchors at 0.97 confidence), so this resolver reads
 * that field first and falls back to canonical_type only when ai_form_numbers
 * is absent or unrecognized.
 *
 * Pure function. No DB, no server-only imports, no side effects.
 */

import type { IrsFormType } from "@/lib/irsKnowledge/types";

type DocRow = {
  canonical_type: string | null;
  ai_form_numbers: string[] | null;
  document_type: string | null;
};

/**
 * Set of canonical_type values that indicate a document is a tax return
 * and therefore is a candidate for IRS identity validation.
 *
 * Exported so callers (validator self-gate, backfill script) can filter
 * before invoking the validator, avoiding SKIPPED-row noise on bank
 * statements, PFS, AR aging, etc.
 */
export const TAX_RETURN_CANONICAL_TYPES = new Set<string>([
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "INDIVIDUAL_TAX_RETURN",
  "TAX_RETURN_1040",
  "TAX_RETURN_1065",
  "TAX_RETURN_1120",
  "TAX_RETURN_1120S",
  "PARTNERSHIP_RETURN",
  "CORPORATE_RETURN",
  "S_CORP_RETURN",
  "TAX_RETURN",
  "FORM_1040",
  "FORM_1065",
  "FORM_1120",
  "FORM_1120S",
  "SCHEDULE_E",
  "SCHEDULE_C",
]);

export function isTaxReturnDocument(row: { canonical_type: string | null }): boolean {
  if (!row.canonical_type) return false;
  return TAX_RETURN_CANONICAL_TYPES.has(row.canonical_type.toUpperCase());
}

/**
 * Resolve a document row to its IRS form type for validation routing.
 *
 * Priority:
 *   1. If ai_form_numbers contains a known form number, use it (most specific signal).
 *   2. If canonical_type is one of the specific TAX_RETURN_* / FORM_* types, use the legacy map.
 *   3. Return null — caller decides whether to persist a SKIPPED row.
 */
export function resolveIrsFormType(row: DocRow): IrsFormType | null {
  const formNumbers = row.ai_form_numbers ?? [];

  for (const fn of formNumbers) {
    const normalized = fn.toUpperCase().replace(/\s+/g, "");
    if (normalized === "1120S") return "FORM_1120S";
    if (normalized === "1120") return "FORM_1120";
    if (normalized === "1065") return "FORM_1065";
    if (normalized === "1040" || normalized === "1040-SR") return "FORM_1040";
  }

  const ct = (row.canonical_type ?? "").toUpperCase();
  const SPECIFIC_MAP: Record<string, IrsFormType> = {
    TAX_RETURN_1065: "FORM_1065",
    TAX_RETURN_1120: "FORM_1120",
    TAX_RETURN_1120S: "FORM_1120S",
    TAX_RETURN_1040: "FORM_1040",
    PARTNERSHIP_RETURN: "FORM_1065",
    CORPORATE_RETURN: "FORM_1120",
    S_CORP_RETURN: "FORM_1120S",
    INDIVIDUAL_TAX_RETURN: "FORM_1040",
    PERSONAL_TAX_RETURN: "FORM_1040",
    SCHEDULE_E: "SCHEDULE_E",
    SCHEDULE_C: "SCHEDULE_C",
  };
  if (SPECIFIC_MAP[ct]) return SPECIFIC_MAP[ct];

  return null;
}
