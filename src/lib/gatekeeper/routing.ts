/**
 * OpenAI Gatekeeper — Deterministic Routing Rules (PURE)
 *
 * No DB, no IO, no side effects. Fully testable.
 *
 * Two exports:
 *  - computeGatekeeperRoute() — applies threshold + type rules to derive route
 *  - mapGatekeeperToCanonicalHint() — maps gatekeeper types to existing
 *    ExtendedCanonicalType / RoutingClass as HINTS (not authoritative writes)
 */
import type { GatekeeperClassification, GatekeeperDocType, GatekeeperRoute } from "./types";

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.80;

/** Core doc types that route to Google Document AI. */
const CORE_TYPES: ReadonlySet<GatekeeperDocType> = new Set([
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "W2",
  "FORM_1099",
  "K1",
]);

// ─── Route Computation ──────────────────────────────────────────────────────

/**
 * Deterministic routing rules applied to the raw model classification.
 *
 * Priority:
 * 1) doc_type === UNKNOWN → NEEDS_REVIEW
 * 2) confidence < 0.80 → NEEDS_REVIEW
 * 3) Tax return (BUSINESS or PERSONAL) with null tax_year → NEEDS_REVIEW
 * 4) CORE type → GOOGLE_DOC_AI_CORE
 * 5) Everything else → STANDARD
 */
export function computeGatekeeperRoute(
  classification: Pick<GatekeeperClassification, "doc_type" | "confidence" | "tax_year">,
): GatekeeperRoute {
  // Rule 1: UNKNOWN always needs review
  if (classification.doc_type === "UNKNOWN") {
    return "NEEDS_REVIEW";
  }

  // Rule 2: Low confidence
  if (classification.confidence < CONFIDENCE_THRESHOLD) {
    return "NEEDS_REVIEW";
  }

  // Rule 3: Tax return without year
  if (
    (classification.doc_type === "BUSINESS_TAX_RETURN" ||
      classification.doc_type === "PERSONAL_TAX_RETURN") &&
    classification.tax_year === null
  ) {
    return "NEEDS_REVIEW";
  }

  // Rule 4: Core doc
  if (CORE_TYPES.has(classification.doc_type)) {
    return "GOOGLE_DOC_AI_CORE";
  }

  // Rule 5: Everything else
  return "STANDARD";
}

// ─── Canonical Type Hint Mapping ────────────────────────────────────────────

/**
 * Map a GatekeeperDocType to existing pipeline types as a HINT.
 *
 * IMPORTANT: These are HINTS, not authoritative writes.
 * The classify processor may use them when canonical_type is null
 * and the doc is not manually classified or finalized.
 *
 * Types align with ExtendedCanonicalType and RoutingClass from
 * src/lib/documents/docTypeRouting.ts.
 */
export function mapGatekeeperToCanonicalHint(docType: GatekeeperDocType): {
  canonical_type_hint: string;
  routing_class_hint: string;
} {
  switch (docType) {
    case "BUSINESS_TAX_RETURN":
      return { canonical_type_hint: "BUSINESS_TAX_RETURN", routing_class_hint: "DOC_AI_ATOMIC" };
    case "PERSONAL_TAX_RETURN":
    case "W2":
    case "FORM_1099":
    case "K1":
      return { canonical_type_hint: "PERSONAL_TAX_RETURN", routing_class_hint: "DOC_AI_ATOMIC" };
    case "BANK_STATEMENT":
      return { canonical_type_hint: "BANK_STATEMENT", routing_class_hint: "GEMINI_STANDARD" };
    case "FINANCIAL_STATEMENT":
      return { canonical_type_hint: "FINANCIAL_STATEMENT", routing_class_hint: "GEMINI_PACKET" };
    case "DRIVERS_LICENSE":
      return { canonical_type_hint: "ENTITY_DOCS", routing_class_hint: "GEMINI_STANDARD" };
    case "VOIDED_CHECK":
    case "OTHER":
    case "UNKNOWN":
    default:
      return { canonical_type_hint: "OTHER", routing_class_hint: "GEMINI_STANDARD" };
  }
}
