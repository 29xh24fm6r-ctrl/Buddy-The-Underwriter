/**
 * Canonical Doc-Type Routing
 *
 * Single source of truth for:
 *  1. Normalizing raw classifier / inferred doc types → canonical_type
 *  2. Mapping canonical_type → routing_class (DOC_AI_ATOMIC | GEMINI_PACKET | GEMINI_STANDARD)
 *
 * The Smart Router reads routing_class from deal_documents to decide the
 * extraction engine. The classify processor stamps both columns after
 * classification completes.
 *
 * LOCKED — do not expand DOC_AI_ATOMIC without explicit approval.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Routing classes determine which extraction engine processes a document.
 *
 * DOC_AI_ATOMIC:    Google Document AI — underwriting-critical structured docs
 *                   (tax returns, income statements, balance sheets, PFS)
 * GEMINI_PACKET:    Gemini OCR with multi-page/tabular awareness
 *                   (T12/generic financials)
 * GEMINI_STANDARD:  Standard Gemini OCR — single-pass text extraction
 *                   (bank statements, leases, insurance, appraisals, etc.)
 */
export type RoutingClass = "DOC_AI_ATOMIC" | "GEMINI_PACKET" | "GEMINI_STANDARD";

/**
 * Extended canonical types — more granular than CanonicalDocumentType.
 * Distinguishes INCOME_STATEMENT and BALANCE_SHEET from generic FINANCIAL_STATEMENT.
 */
export type ExtendedCanonicalType =
  | "BUSINESS_TAX_RETURN"
  | "PERSONAL_TAX_RETURN"
  | "INCOME_STATEMENT"
  | "BALANCE_SHEET"
  | "PFS"
  | "FINANCIAL_STATEMENT"
  | "BANK_STATEMENT"
  | "RENT_ROLL"
  | "LEASE"
  | "INSURANCE"
  | "APPRAISAL"
  | "ENTITY_DOCS"
  | "OTHER";

export type DocTypeRoutingResult = {
  canonical_type: ExtendedCanonicalType;
  routing_class: RoutingClass;
};

// ─── Raw Type → Canonical Type Mapping ────────────────────────────────────────

/**
 * Normalize any raw document type string to an ExtendedCanonicalType.
 *
 * Handles:
 * - AI classifier output (IRS_BUSINESS, T12, K1, etc.)
 * - Form numbers (1120, 1040, etc.)
 * - Inferred types (income_statement, balance_sheet)
 * - Alternate names (P&L, PROFIT_AND_LOSS, SBA_413)
 * - Legacy aliases (IRS_PERSONAL, INTERIM_FINANCIALS)
 */
function normalizeToExtendedCanonical(raw: string): ExtendedCanonicalType {
  const upper = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (!upper) return "OTHER";

  // ─── Tax Returns ──────────────────────────────────────────
  if (
    [
      "IRS_BUSINESS",
      "IRS_1120",
      "IRS_1120S",
      "IRS_1065",
      "BUSINESS_TAX_RETURN",
    ].includes(upper)
  )
    return "BUSINESS_TAX_RETURN";

  if (
    [
      "IRS_PERSONAL",
      "IRS_1040",
      "PERSONAL_TAX_RETURN",
      "K1",
      "SCHEDULE_K1",
      "W2",
      "1099",
    ].includes(upper)
  )
    return "PERSONAL_TAX_RETURN";

  // ─── Specific Financial Sub-Types ─────────────────────────
  if (["INCOME_STATEMENT", "PROFIT_AND_LOSS", "P&L"].includes(upper))
    return "INCOME_STATEMENT";

  if (upper === "BALANCE_SHEET") return "BALANCE_SHEET";

  // ─── Personal Financial Statement ─────────────────────────
  if (["PFS", "PERSONAL_FINANCIAL_STATEMENT", "SBA_413"].includes(upper))
    return "PFS";

  // ─── Generic Financial Statement (includes T12) ───────────
  if (
    [
      "FINANCIAL_STATEMENT",
      "T12",
      "INTERIM_FINANCIALS",
    ].includes(upper)
  )
    return "FINANCIAL_STATEMENT";

  // ─── Standard Types ───────────────────────────────────────
  if (upper === "BANK_STATEMENT") return "BANK_STATEMENT";
  if (upper === "RENT_ROLL") return "RENT_ROLL";
  if (upper === "LEASE") return "LEASE";
  if (["INSURANCE", "COI", "INSURANCE_CERT"].includes(upper))
    return "INSURANCE";
  if (["APPRAISAL", "ENVIRONMENTAL", "SCHEDULE_OF_RE"].includes(upper))
    return "APPRAISAL";
  if (
    [
      "ENTITY_DOCS",
      "ARTICLES",
      "OPERATING_AGREEMENT",
      "BYLAWS",
      "BUSINESS_LICENSE",
      "DRIVERS_LICENSE",
    ].includes(upper)
  )
    return "ENTITY_DOCS";

  return "OTHER";
}

// ─── Canonical Type → Routing Class ──────────────────────────────────────────

/**
 * LOCKED mapping from canonical_type to routing_class.
 * DO NOT expand DOC_AI_ATOMIC without explicit approval.
 */
const ROUTING_CLASS_MAP: Record<ExtendedCanonicalType, RoutingClass> = {
  // DOC_AI_ATOMIC: Underwriting-critical, multi-table semantic integrity
  BUSINESS_TAX_RETURN: "DOC_AI_ATOMIC",
  PERSONAL_TAX_RETURN: "DOC_AI_ATOMIC",
  INCOME_STATEMENT: "DOC_AI_ATOMIC",
  BALANCE_SHEET: "DOC_AI_ATOMIC",
  PFS: "DOC_AI_ATOMIC",

  // GEMINI_PACKET: Tabular/multi-page docs well-handled by Gemini
  FINANCIAL_STATEMENT: "GEMINI_PACKET",

  // GEMINI_STANDARD: Standard single-pass OCR
  RENT_ROLL: "GEMINI_STANDARD",
  BANK_STATEMENT: "GEMINI_STANDARD",
  LEASE: "GEMINI_STANDARD",
  INSURANCE: "GEMINI_STANDARD",
  APPRAISAL: "GEMINI_STANDARD",
  ENTITY_DOCS: "GEMINI_STANDARD",
  OTHER: "GEMINI_STANDARD",
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Normalize a raw document type and determine its routing class.
 *
 * This is the main entry point — call it from the classify processor
 * to stamp deal_documents.canonical_type and deal_documents.routing_class.
 *
 * @example
 * ```ts
 * const { canonical_type, routing_class } = resolveDocTypeRouting("IRS_BUSINESS");
 * // → { canonical_type: "BUSINESS_TAX_RETURN", routing_class: "DOC_AI_ATOMIC" }
 *
 * const result = resolveDocTypeRouting("T12");
 * // → { canonical_type: "FINANCIAL_STATEMENT", routing_class: "GEMINI_PACKET" }
 * ```
 */
export function resolveDocTypeRouting(rawDocType: string): DocTypeRoutingResult {
  const canonical_type = normalizeToExtendedCanonical(rawDocType);
  const routing_class = ROUTING_CLASS_MAP[canonical_type];
  return { canonical_type, routing_class };
}

/**
 * Get the routing class for a canonical type.
 * Useful when you already have the canonical_type and just need the routing.
 */
export function routingClassFor(canonicalType: string): RoutingClass {
  return (
    ROUTING_CLASS_MAP[canonicalType as ExtendedCanonicalType] ?? "GEMINI_STANDARD"
  );
}

/**
 * Check if a routing class routes to Document AI.
 */
export function isDocAiRoute(routingClass: RoutingClass): boolean {
  return routingClass === "DOC_AI_ATOMIC";
}
