/**
 * Effective Classification — System-Wide Truth Resolver (PURE)
 *
 * Deterministic COALESCE resolution for document classification.
 * All subsystems consume this single resolver.
 * No subsystem reads raw gatekeeper values for decisions again.
 *
 * Resolution order:
 *   Type: canonical_type > document_type > gatekeeper_doc_type > ai_doc_type > "UNKNOWN"
 *   Year: doc_year > gatekeeper_tax_year > ai_tax_year > null
 *
 * Human-confirmed truth (intake_confirmed_at != null) always takes source "CONFIRMED".
 *
 * No DB, no IO, no side effects. Fully testable.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ClassificationSource =
  | "CONFIRMED"
  | "CANONICAL"
  | "GATEKEEPER"
  | "AI"
  | "UNKNOWN";

export type ClassificationInput = {
  canonical_type?: string | null;
  document_type?: string | null;
  gatekeeper_doc_type?: string | null;
  ai_doc_type?: string | null;
  doc_year?: number | null;
  gatekeeper_tax_year?: number | null;
  ai_tax_year?: number | null;
  intake_confirmed_at?: string | null;
};

export type ResolvedClassification = {
  effectiveDocType: string;
  effectiveTaxYear: number | null;
  source: ClassificationSource;
  isConfirmed: boolean;
};

// ─── Resolver ────────────────────────────────────────────────────────────────

export function resolveEffectiveClassification(
  input: ClassificationInput,
): ResolvedClassification {
  const isConfirmed = input.intake_confirmed_at != null;

  // Type COALESCE: canonical_type > document_type > gatekeeper_doc_type > ai_doc_type
  let effectiveDocType = "UNKNOWN";
  let typeSource: "CANONICAL" | "GATEKEEPER" | "AI" | "UNKNOWN" = "UNKNOWN";

  if (input.canonical_type) {
    effectiveDocType = input.canonical_type;
    typeSource = "CANONICAL";
  } else if (input.document_type) {
    effectiveDocType = input.document_type;
    typeSource = "CANONICAL";
  } else if (input.gatekeeper_doc_type) {
    effectiveDocType = input.gatekeeper_doc_type;
    typeSource = "GATEKEEPER";
  } else if (input.ai_doc_type) {
    effectiveDocType = input.ai_doc_type;
    typeSource = "AI";
  }

  // Year COALESCE: doc_year > gatekeeper_tax_year > ai_tax_year
  let effectiveTaxYear: number | null = null;

  if (input.doc_year != null) {
    effectiveTaxYear = input.doc_year;
  } else if (input.gatekeeper_tax_year != null) {
    effectiveTaxYear = input.gatekeeper_tax_year;
  } else if (input.ai_tax_year != null) {
    effectiveTaxYear = input.ai_tax_year;
  }

  // Source: CONFIRMED overrides all when human has confirmed
  const source: ClassificationSource = isConfirmed ? "CONFIRMED" : typeSource;

  return {
    effectiveDocType,
    effectiveTaxYear,
    source,
    isConfirmed,
  };
}
