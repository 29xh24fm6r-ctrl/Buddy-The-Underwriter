/**
 * Derive a human-readable display name for a classified document.
 *
 * Two-phase naming:
 *  - Phase 1 (provisional): sanitized original_filename
 *  - Phase 2 (derived): "Doc Label — YEAR" or "Doc Label — Entity Name"
 *
 * This function is PURE — no DB access, no side effects.
 */

import type { CanonicalDocumentType } from "@/lib/documents/classify";

// ─── Human-readable labels for canonical doc types ───────────────────────────

const DOC_TYPE_LABELS: Record<CanonicalDocumentType, string> = {
  BUSINESS_TAX_RETURN: "Business Tax Return",
  PERSONAL_TAX_RETURN: "Personal Tax Return",
  PFS: "Personal Financial Statement",
  FINANCIAL_STATEMENT: "Financial Statement",
  BANK_STATEMENT: "Bank Statement",
  RENT_ROLL: "Rent Roll",
  LEASE: "Lease",
  INSURANCE: "Insurance",
  APPRAISAL: "Appraisal",
  ENTITY_DOCS: "Entity Documents",
  OTHER: "Document",
};

// ─── Types ───────────────────────────────────────────────────────────────────

export type DeriveDocumentDisplayNameInput = {
  originalFilename: string;
  documentType: CanonicalDocumentType | string | null;
  docYear: number | null;
  entityName: string | null;
  classificationConfidence: number | null;
};

export type DeriveDocumentDisplayNameResult = {
  displayName: string;
  method: "provisional" | "derived";
  source: "classification" | "filename";
  confidence: number | null;
  fallbackReason: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Sanitize a filename for display: remove extension, replace separators.
 */
function sanitizeFilename(filename: string): string {
  // Remove file extension
  const withoutExt = filename.replace(/\.[^.]+$/, "");
  // Replace underscores, dashes, multiple spaces with single space
  return withoutExt
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Truncate entity name to a reasonable display length.
 */
function truncateEntity(name: string, maxLen: number = 60): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1).trim() + "\u2026";
}

// ─── Main function ───────────────────────────────────────────────────────────

export function deriveDocumentDisplayName(
  input: DeriveDocumentDisplayNameInput,
): DeriveDocumentDisplayNameResult {
  const { originalFilename, documentType, docYear, entityName, classificationConfidence } = input;

  // If we don't have a classified doc type, fall back to provisional
  if (!documentType || documentType === "OTHER") {
    return {
      displayName: sanitizeFilename(originalFilename) || originalFilename,
      method: "provisional",
      source: "filename",
      confidence: null,
      fallbackReason: documentType === "OTHER" ? "classified_as_other" : "missing_classification",
    };
  }

  const label = DOC_TYPE_LABELS[documentType as CanonicalDocumentType] ?? documentType;
  const parts: string[] = [label];

  // Append entity name if available
  if (entityName?.trim()) {
    parts.push(truncateEntity(entityName));
  }

  // Append year if available
  if (docYear && Number.isFinite(docYear)) {
    parts.push(String(docYear));
  }

  // Join: "Business Tax Return — ABC Corp (2023)" or "Business Tax Return — 2023"
  let displayName: string;
  if (parts.length === 1) {
    displayName = parts[0];
  } else if (parts.length === 2) {
    displayName = `${parts[0]} \u2014 ${parts[1]}`;
  } else {
    // label — entity (year)
    displayName = `${parts[0]} \u2014 ${parts[1]} (${parts[2]})`;
  }

  return {
    displayName,
    method: "derived",
    source: "classification",
    confidence: classificationConfidence,
    fallbackReason: null,
  };
}
