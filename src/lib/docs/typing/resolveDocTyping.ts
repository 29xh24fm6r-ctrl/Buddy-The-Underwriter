/**
 * Central Document Typing Resolver
 *
 * Single function that takes raw AI classification output and produces
 * the complete typing result: canonical_type, routing_class, checklist_key,
 * plus form-number guardrails that prevent personal/business mislabels.
 *
 * HARD RULES (never overridden by AI):
 *  - Form 1040  → PERSONAL_TAX_RETURN
 *  - Form 1120 / 1120S / 1065 → BUSINESS_TAX_RETURN
 */

import {
  resolveDocTypeRouting,
  type ExtendedCanonicalType,
  type RoutingClass,
} from "@/lib/documents/docTypeRouting";
import { normalizeToCanonical } from "@/lib/documents/normalizeType";
import { mapDocTypeToChecklistKeys, type DocumentType } from "@/lib/artifacts/classifyDocument";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResolveDocTypingInput = {
  aiDocType: string;
  aiFormNumbers: string[] | null;
  aiConfidence: number;
  aiTaxYear: number | null;
  aiEntityType: "business" | "personal" | null;
};

export type ResolveDocTypingResult = {
  /** Extended canonical type (BUSINESS_TAX_RETURN, PERSONAL_TAX_RETURN, etc.) */
  canonical_type: ExtendedCanonicalType;
  /** Extraction engine routing class */
  routing_class: RoutingClass;
  /** First matching checklist key (null if no match) */
  checklist_key: string | null;
  /** Coarser canonical type for document_type column */
  document_type: string;
  /** The effective docType after guardrails (may differ from input) */
  effective_doc_type: string;
  /** True if a form-number guardrail overrode the AI classification */
  guardrail_applied: boolean;
  /** Reason for the guardrail override (null if none) */
  guardrail_reason: string | null;
};

// ─── Form-Number Guardrails ──────────────────────────────────────────────────

const PERSONAL_FORMS = new Set(["1040", "1040SR", "1040NR", "1040X"]);
const BUSINESS_FORMS = new Set(["1120", "1120S", "1065"]);

function applyFormNumberGuardrails(
  aiDocType: string,
  formNumbers: string[] | null,
): { overrideDocType: string | null; reason: string | null } {
  if (!formNumbers || formNumbers.length === 0) {
    return { overrideDocType: null, reason: null };
  }

  const normalized = formNumbers.map((f) =>
    f.toUpperCase().replace(/[^A-Z0-9]/g, ""),
  );

  // HARD RULE: 1040 variants → PERSONAL always
  const personalForm = normalized.find((f) => PERSONAL_FORMS.has(f));
  if (personalForm && aiDocType !== "IRS_PERSONAL") {
    return {
      overrideDocType: "IRS_PERSONAL",
      reason: `form_${personalForm.toLowerCase()}_forces_personal`,
    };
  }

  // HARD RULE: 1120/1120S/1065 → BUSINESS always
  const businessForm = normalized.find((f) => BUSINESS_FORMS.has(f));
  if (businessForm && aiDocType !== "IRS_BUSINESS") {
    return {
      overrideDocType: "IRS_BUSINESS",
      reason: `form_${businessForm.toLowerCase()}_forces_business`,
    };
  }

  return { overrideDocType: null, reason: null };
}

// ─── Main Resolver ───────────────────────────────────────────────────────────

export function resolveDocTyping(input: ResolveDocTypingInput): ResolveDocTypingResult {
  const { aiDocType, aiFormNumbers, aiTaxYear } = input;

  // 1. Apply form-number guardrails
  const { overrideDocType, reason } = applyFormNumberGuardrails(aiDocType, aiFormNumbers);
  const effectiveDocType = overrideDocType ?? aiDocType;

  // 2. Resolve canonical type + routing class via existing infrastructure
  const { canonical_type, routing_class } = resolveDocTypeRouting(effectiveDocType);

  // 3. Coarser canonical for document_type column
  const document_type = normalizeToCanonical(effectiveDocType);

  // 4. Compute checklist key (first match)
  const checklist_key =
    mapDocTypeToChecklistKeys(effectiveDocType as DocumentType, aiTaxYear)[0] ?? null;

  return {
    canonical_type,
    routing_class,
    checklist_key,
    document_type,
    effective_doc_type: effectiveDocType,
    guardrail_applied: overrideDocType !== null,
    guardrail_reason: reason,
  };
}
