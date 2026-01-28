/**
 * Canonical Document Classification Types
 *
 * This is the SINGLE SOURCE OF TRUTH for document type classification.
 * All classification paths must return a CanonicalDocumentType.
 *
 * The actual AI classification happens in `@/lib/artifacts/classifyDocument.ts`.
 * This module provides the canonical type mapping and re-exports for consumers.
 */

/**
 * Canonical document types — the authoritative enum for deal_documents.document_type.
 */
export type CanonicalDocumentType =
  | "BUSINESS_TAX_RETURN"
  | "PERSONAL_TAX_RETURN"
  | "PFS"
  | "FINANCIAL_STATEMENT"
  | "BANK_STATEMENT"
  | "RENT_ROLL"
  | "LEASE"
  | "INSURANCE"
  | "APPRAISAL"
  | "ENTITY_DOCS"
  | "OTHER";

/**
 * Canonical classification result for stamping deal_documents.
 */
export type ClassificationStamp = {
  documentType: CanonicalDocumentType;
  confidence: number; // 0–1
  docYear: number | null;
  docYears: number[] | null;
  entityName: string | null;
  reason: string;
};

/**
 * Map the detailed AI classifier DocumentType to canonical CanonicalDocumentType.
 *
 * The AI classifier returns fine-grained types (IRS_BUSINESS, K1, W2, etc.).
 * This function collapses them to the canonical enum for deal_documents.document_type.
 */
export function toCanonicalDocType(aiDocType: string): CanonicalDocumentType {
  switch (aiDocType) {
    case "IRS_BUSINESS":
      return "BUSINESS_TAX_RETURN";

    case "IRS_PERSONAL":
    case "W2":
    case "1099":
    case "K1":
      return "PERSONAL_TAX_RETURN";

    case "PFS":
      return "PFS";

    case "T12":
      return "FINANCIAL_STATEMENT";

    case "BANK_STATEMENT":
      return "BANK_STATEMENT";

    case "RENT_ROLL":
      return "RENT_ROLL";

    case "LEASE":
      return "LEASE";

    case "INSURANCE":
      return "INSURANCE";

    case "APPRAISAL":
    case "ENVIRONMENTAL":
    case "SCHEDULE_OF_RE":
      return "APPRAISAL";

    case "ARTICLES":
    case "OPERATING_AGREEMENT":
    case "BYLAWS":
    case "BUSINESS_LICENSE":
    case "DRIVERS_LICENSE":
      return "ENTITY_DOCS";

    default:
      return "OTHER";
  }
}

/**
 * Map canonical document type to possible checklist keys.
 * This is the canonical mapping used after classification to satisfy checklist items.
 */
export function canonicalTypeToChecklistKeys(
  docType: CanonicalDocumentType,
): string[] {
  switch (docType) {
    case "BUSINESS_TAX_RETURN":
      return ["IRS_BUSINESS_3Y", "IRS_BUSINESS_2Y"];
    case "PERSONAL_TAX_RETURN":
      return ["IRS_PERSONAL_3Y", "IRS_PERSONAL_2Y"];
    case "PFS":
      return ["PFS_CURRENT"];
    case "FINANCIAL_STATEMENT":
      return ["FIN_STMT_PL_YTD", "FIN_STMT_BS_YTD", "PROPERTY_T12"];
    case "BANK_STATEMENT":
      return ["BANK_STMT_3M"];
    case "RENT_ROLL":
      return ["RENT_ROLL"];
    case "LEASE":
      return ["LEASES_TOP"];
    case "INSURANCE":
      return ["PROPERTY_INSURANCE"];
    case "APPRAISAL":
      return ["APPRAISAL_IF_AVAILABLE"];
    case "ENTITY_DOCS":
      return ["ENTITY_DOCS"];
    case "OTHER":
      return [];
  }
}
