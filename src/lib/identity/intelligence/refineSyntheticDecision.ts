/**
 * Synthetic Entity Naming Decision Engine — Phase 2.5 (Pure)
 *
 * Determines whether a synthetic entity should be renamed based on available signals.
 * Zero DB calls. Deterministic. Exported for CI guard import.
 *
 * Signal hierarchy (highest to lowest confidence):
 *   1. Banker-provided name from borrowers.legal_name
 *   2. Document entity name from deal_documents.entity_name (Gemini classifier)
 *
 * Decision rules:
 *   not synthetic           → NO_CHANGE (not_synthetic)
 *   unknown entity_kind     → NO_CHANGE (unknown_kind)
 *   1 unique doc name, no banker conflict → RENAME_SYNTHETIC HIGH (single_doc_name_match)
 *   banker name only        → RENAME_SYNTHETIC HIGH (banker_name_only)
 *   banker name + all docs match → RENAME_SYNTHETIC HIGH (banker_name_confirmed_by_docs)
 *   name conflict / no signal → NO_CHANGE INSUFFICIENT
 */

export type DocumentSignal = {
  document_type: string;
  entity_name: string | null;
  classification_confidence: number | null;
};

export type RefineSyntheticDecision = {
  action: "RENAME_SYNTHETIC" | "NO_CHANGE";
  proposedName?: string;
  confidence: "HIGH" | "INSUFFICIENT";
  reason: string;
};

export type SyntheticEntity = {
  id: string;
  entity_kind: string;
  name: string;
  synthetic: boolean;
};

/**
 * Authoritative mapping: entity_kind → doc types that carry entity names.
 * Exported as single source of truth — used by orchestration engine and CI guards.
 */
export const NAME_DOC_TYPES_FOR_KIND: Record<string, string[]> = {
  PERSON: ["PERSONAL_TAX_RETURN", "PERSONAL_FINANCIAL_STATEMENT"],
  OPCO: ["BUSINESS_TAX_RETURN"],
  PROPCO: ["BUSINESS_TAX_RETURN"],
  HOLDCO: ["BUSINESS_TAX_RETURN"],
};

export function computeRefineSyntheticDecision(
  entity: SyntheticEntity,
  documents: DocumentSignal[],
  borrowerLegalName: string | null,
): RefineSyntheticDecision {
  if (!entity.synthetic) {
    return { action: "NO_CHANGE", confidence: "INSUFFICIENT", reason: "not_synthetic" };
  }

  const relevantDocTypes = NAME_DOC_TYPES_FOR_KIND[entity.entity_kind];
  if (!relevantDocTypes) {
    return { action: "NO_CHANGE", confidence: "INSUFFICIENT", reason: "unknown_kind" };
  }

  // Collect names from relevant documents (non-null, non-empty)
  const docNames = documents
    .filter((d) => relevantDocTypes.includes(d.document_type) && d.entity_name?.trim())
    .map((d) => d.entity_name!.trim());

  const uniqueDocNames = [...new Set(docNames)];

  // Collect banker-provided name signal (borrowers.legal_name)
  const bankerName = borrowerLegalName?.trim() || null;

  // Exactly one unique doc name and no conflict with banker name
  if (
    uniqueDocNames.length === 1 &&
    (!bankerName || bankerName === uniqueDocNames[0])
  ) {
    return {
      action: "RENAME_SYNTHETIC",
      proposedName: uniqueDocNames[0],
      confidence: "HIGH",
      reason: "single_doc_name_match",
    };
  }

  // Banker name only (no doc names yet)
  if (uniqueDocNames.length === 0 && bankerName) {
    return {
      action: "RENAME_SYNTHETIC",
      proposedName: bankerName,
      confidence: "HIGH",
      reason: "banker_name_only",
    };
  }

  // Banker name matches all doc names
  if (
    uniqueDocNames.length >= 1 &&
    bankerName &&
    uniqueDocNames.every((n) => n === bankerName)
  ) {
    return {
      action: "RENAME_SYNTHETIC",
      proposedName: bankerName,
      confidence: "HIGH",
      reason: "banker_name_confirmed_by_docs",
    };
  }

  // Multiple unique names or conflict → insufficient
  return {
    action: "NO_CHANGE",
    confidence: "INSUFFICIENT",
    reason: uniqueDocNames.length > 1 ? "name_conflict" : "no_signal",
  };
}
