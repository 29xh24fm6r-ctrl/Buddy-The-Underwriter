/**
 * OpenAI Gatekeeper — Deterministic Routing Rules (PURE)
 *
 * No DB, no IO, no side effects. Fully testable.
 *
 * Three exports:
 *  - computeGatekeeperRoute() — applies threshold + type rules to derive route
 *  - mapGatekeeperToCanonicalHint() — maps gatekeeper types to existing
 *    ExtendedCanonicalType / RoutingClass as HINTS (not authoritative writes)
 *  - mapGatekeeperDocTypeToEffectiveDocType() — maps gatekeeper types to
 *    effectiveDocType strings for extraction eligibility + spread routing
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

/** Types explicitly eligible for STANDARD route. Anything NOT in CORE_TYPES
 *  and NOT in this set will defensively route to NEEDS_REVIEW. */
const STANDARD_ELIGIBLE: ReadonlySet<GatekeeperDocType> = new Set([
  "BANK_STATEMENT",
  "FINANCIAL_STATEMENT",
  "PERSONAL_FINANCIAL_STATEMENT",
  "DRIVERS_LICENSE",
  "VOIDED_CHECK",
  "OTHER",
]);

// ─── Route Computation ──────────────────────────────────────────────────────

/**
 * Deterministic routing rules applied to the raw model classification.
 * TOTAL function — every GatekeeperDocType maps to exactly one route.
 *
 * Priority:
 * 1) doc_type === UNKNOWN → NEEDS_REVIEW
 * 2) confidence < 0.80 → NEEDS_REVIEW
 * 3) Tax return (BUSINESS or PERSONAL) with null tax_year → NEEDS_REVIEW
 * 4) CORE type → GOOGLE_DOC_AI_CORE
 * 5) Explicit STANDARD allowlist → STANDARD
 * 6) Defensive fallback → NEEDS_REVIEW
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

  // Rule 5: Explicit STANDARD allowlist
  if (STANDARD_ELIGIBLE.has(classification.doc_type)) {
    return "STANDARD";
  }

  // Rule 6: Defensive — unrecognized type → NEEDS_REVIEW
  return "NEEDS_REVIEW";
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
    case "PERSONAL_FINANCIAL_STATEMENT":
      return { canonical_type_hint: "PFS", routing_class_hint: "DOC_AI_ATOMIC" };
    case "DRIVERS_LICENSE":
      return { canonical_type_hint: "ENTITY_DOCS", routing_class_hint: "GEMINI_STANDARD" };
    case "VOIDED_CHECK":
    case "OTHER":
    case "UNKNOWN":
    default:
      return { canonical_type_hint: "OTHER", routing_class_hint: "GEMINI_STANDARD" };
  }
}

// ─── Effective Doc Type Mapping (Primary Routing) ───────────────────────────

/**
 * Map a GatekeeperDocType to an effectiveDocType string for use in:
 *  - isExtractEligibleDocType() gate (processArtifact.ts)
 *  - spreadsForDocType() spread selection (docTypeToSpreadTypes.ts)
 *
 * Pure function — no DB, no side effects, deterministic.
 */
export function mapGatekeeperDocTypeToEffectiveDocType(
  docType: GatekeeperDocType,
): string {
  switch (docType) {
    case "BUSINESS_TAX_RETURN":
      return "BUSINESS_TAX_RETURN";
    case "PERSONAL_TAX_RETURN":
    case "W2":
    case "FORM_1099":
    case "K1":
      return "PERSONAL_TAX_RETURN";
    case "BANK_STATEMENT":
      return "BANK_STATEMENT";
    case "FINANCIAL_STATEMENT":
      return "FINANCIAL_STATEMENT";
    case "PERSONAL_FINANCIAL_STATEMENT":
      return "PERSONAL_FINANCIAL_STATEMENT";
    case "DRIVERS_LICENSE":
      return "ENTITY_DOCS";
    case "VOIDED_CHECK":
    case "OTHER":
    case "UNKNOWN":
    default:
      return "OTHER";
  }
}
