/**
 * Derive a deal name from classified documents using an anchor-doc strategy.
 *
 * Priority (best anchor):
 *   1. BUSINESS_TAX_RETURN (latest year)
 *   2. PERSONAL_TAX_RETURN (latest year)
 *   3. PFS
 *   4. FINANCIAL_STATEMENT (YTD)
 *
 * Name format:
 *   - entity_name + year → "ABC Corp — BTR 2023"
 *   - entity_name only   → "ABC Corp"
 *   - type + year only   → "Deal — BTR 2023"
 *   - fallback           → null (caller keeps provisional)
 *
 * This function is PURE — no DB access, no side effects.
 */

import type { CanonicalDocumentType } from "@/lib/documents/classify";

// ─── Short labels for deal naming ────────────────────────────────────────────

const DEAL_DOC_SHORT_LABELS: Partial<Record<CanonicalDocumentType, string>> = {
  BUSINESS_TAX_RETURN: "BTR",
  PERSONAL_TAX_RETURN: "PTR",
  PFS: "PFS",
  FINANCIAL_STATEMENT: "Financials",
};

// ─── Anchor priority (lower index = higher priority) ─────────────────────────

const ANCHOR_PRIORITY: CanonicalDocumentType[] = [
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "PFS",
  "FINANCIAL_STATEMENT",
];

// ─── Types ───────────────────────────────────────────────────────────────────

export type AnchorDocCandidate = {
  documentType: CanonicalDocumentType | string;
  docYear: number | null;
  entityName: string | null;
  confidence: number | null;
};

export type DeriveDealNameResult = {
  dealName: string | null;
  method: "derived" | null;
  source: string | null;  // e.g. "BUSINESS_TAX_RETURN"
  anchorDocType: string | null;
  fallbackReason: string | null;
};

// ─── Main function ───────────────────────────────────────────────────────────

export function deriveDealName(
  candidates: AnchorDocCandidate[],
): DeriveDealNameResult {
  if (!candidates.length) {
    return {
      dealName: null,
      method: null,
      source: null,
      anchorDocType: null,
      fallbackReason: "no_classified_documents",
    };
  }

  // Sort candidates by anchor priority, then by year descending, then confidence descending
  const sorted = [...candidates]
    .filter((c) => ANCHOR_PRIORITY.includes(c.documentType as CanonicalDocumentType))
    .sort((a, b) => {
      const aPri = ANCHOR_PRIORITY.indexOf(a.documentType as CanonicalDocumentType);
      const bPri = ANCHOR_PRIORITY.indexOf(b.documentType as CanonicalDocumentType);
      if (aPri !== bPri) return aPri - bPri;

      // Same type: prefer latest year
      const aYear = a.docYear ?? 0;
      const bYear = b.docYear ?? 0;
      if (aYear !== bYear) return bYear - aYear;

      // Same year: prefer higher confidence
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });

  if (sorted.length === 0) {
    return {
      dealName: null,
      method: null,
      source: null,
      anchorDocType: null,
      fallbackReason: "no_anchor_type_documents",
    };
  }

  const anchor = sorted[0];
  const docType = anchor.documentType as CanonicalDocumentType;
  const shortLabel = DEAL_DOC_SHORT_LABELS[docType] ?? docType;
  const entity = anchor.entityName?.trim() || null;
  const year = anchor.docYear;

  let dealName: string;

  if (entity && year) {
    dealName = `${entity} \u2014 ${shortLabel} ${year}`;
  } else if (entity) {
    dealName = entity;
  } else if (year) {
    dealName = `Deal \u2014 ${shortLabel} ${year}`;
  } else {
    dealName = `Deal \u2014 ${shortLabel}`;
  }

  return {
    dealName,
    method: "derived",
    source: docType,
    anchorDocType: docType,
    fallbackReason: null,
  };
}
