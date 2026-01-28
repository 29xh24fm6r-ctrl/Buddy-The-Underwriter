/**
 * AI-powered document classification for Magic Intake.
 *
 * Uses Claude to analyze document content and classify:
 * - Document type (IRS_BUSINESS, IRS_PERSONAL, PFS, RENT_ROLL, T12, etc.)
 * - Tax year (if applicable)
 * - Entity name (business or individual)
 * - Entity type (business vs personal)
 */

import Anthropic from "@anthropic-ai/sdk";

const DOC_TYPES = [
  "IRS_BUSINESS",      // Business tax return (1120, 1120S, 1065)
  "IRS_PERSONAL",      // Personal tax return (1040)
  "PFS",               // Personal Financial Statement
  "RENT_ROLL",         // Rent roll / tenant list
  "T12",               // Trailing 12-month P&L / Operating Statement
  "BANK_STATEMENT",    // Bank statement
  "ARTICLES",          // Articles of incorporation / organization
  "OPERATING_AGREEMENT", // LLC operating agreement
  "BYLAWS",            // Corporate bylaws
  "BUSINESS_LICENSE",  // Business license
  "LEASE",             // Commercial lease agreement
  "INSURANCE",         // Insurance certificate / policy
  "APPRAISAL",         // Property appraisal
  "ENVIRONMENTAL",     // Environmental report (Phase I/II)
  "SCHEDULE_OF_RE",    // Schedule of real estate owned
  "K1",                // Schedule K-1
  "W2",                // W-2 wage statement
  "1099",              // 1099 form
  "DRIVERS_LICENSE",   // Driver's license / ID
  "OTHER",             // Unknown / other document type
] as const;

export type DocumentType = (typeof DOC_TYPES)[number];

export type ClassificationResult = {
  docType: DocumentType;
  confidence: number;
  reason: string;
  taxYear: number | null;
  entityName: string | null;
  entityType: "business" | "personal" | null;
  proposedDealName: string | null;
  proposedDealNameSource: string | null;
  rawExtraction: Record<string, unknown>;
};

const CLASSIFICATION_PROMPT = `You are a document classification expert for commercial lending. Analyze the provided document and extract key information.

DOCUMENT TYPES (choose the most specific match):
- IRS_BUSINESS: Business tax returns (Form 1120, 1120S, 1065, Schedule C)
- IRS_PERSONAL: Personal tax returns (Form 1040)
- PFS: Personal Financial Statement
- RENT_ROLL: Rent roll showing tenants, units, rents
- T12: Trailing 12-month operating statement / P&L
- BANK_STATEMENT: Bank account statement
- ARTICLES: Articles of incorporation/organization
- OPERATING_AGREEMENT: LLC operating agreement
- BYLAWS: Corporate bylaws
- BUSINESS_LICENSE: Business license or permit
- LEASE: Commercial lease agreement
- INSURANCE: Insurance certificate or policy
- APPRAISAL: Property appraisal report
- ENVIRONMENTAL: Environmental assessment (Phase I/II)
- SCHEDULE_OF_RE: Schedule of real estate owned
- K1: Schedule K-1 (partnership/S-corp)
- W2: W-2 wage and tax statement
- 1099: 1099 form (any variant)
- DRIVERS_LICENSE: Driver's license or ID document
- OTHER: Cannot determine type

Respond with a JSON object:
{
  "doc_type": "IRS_BUSINESS",
  "confidence": 0.95,
  "reason": "Form 1120S visible on page 1, showing S-Corporation tax return",
  "tax_year": 2023,
  "entity_name": "ABC Holdings LLC",
  "entity_type": "business",
  "proposed_deal_name": "ABC Holdings LLC",
  "proposed_deal_name_source": "1120s_header"
}

Rules:
- confidence: 0.0 to 1.0 (0.85+ for high confidence)
- tax_year: null if not applicable or not found
- entity_name: The business or individual name from the document
- entity_type: "business" or "personal" or null
- proposed_deal_name: If this is a tax return with a clear business name, suggest it as deal name
- proposed_deal_name_source: Where the name came from (e.g., "schedule_c", "1120s_header", "1040_header")

Be precise. If unsure, lower the confidence. For tax documents, always try to extract the tax year.`;

/**
 * Classify a document using AI.
 *
 * @param documentText - The OCR text content of the document
 * @param filename - Original filename (can help with classification)
 * @param mimeType - MIME type of the file
 */
export async function classifyDocument(
  documentText: string,
  filename: string,
  mimeType: string | null
): Promise<ClassificationResult> {
  const anthropic = new Anthropic();

  // Truncate very long documents
  const maxChars = 15000;
  const truncatedText =
    documentText.length > maxChars
      ? documentText.slice(0, maxChars) + "\n\n[... truncated ...]"
      : documentText;

  const userMessage = `Filename: ${filename}
MIME type: ${mimeType || "unknown"}

Document content:
---
${truncatedText}
---

Classify this document and extract key information. Respond with JSON only.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        { role: "user", content: CLASSIFICATION_PROMPT + "\n\n" + userMessage },
      ],
    });

    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    // Parse JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate doc_type
    const docType = DOC_TYPES.includes(parsed.doc_type)
      ? parsed.doc_type
      : "OTHER";

    return {
      docType,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      reason: String(parsed.reason || ""),
      taxYear: parsed.tax_year ? Number(parsed.tax_year) : null,
      entityName: parsed.entity_name ? String(parsed.entity_name) : null,
      entityType: parsed.entity_type === "business" || parsed.entity_type === "personal"
        ? parsed.entity_type
        : null,
      proposedDealName: parsed.proposed_deal_name
        ? String(parsed.proposed_deal_name)
        : null,
      proposedDealNameSource: parsed.proposed_deal_name_source
        ? String(parsed.proposed_deal_name_source)
        : null,
      rawExtraction: parsed,
    };
  } catch (error: any) {
    console.error("[classifyDocument] AI classification failed", {
      filename,
      error: error?.message,
    });

    // Return low-confidence fallback
    return {
      docType: "OTHER",
      confidence: 0.1,
      reason: `Classification failed: ${error?.message}`,
      taxYear: null,
      entityName: null,
      entityType: null,
      proposedDealName: null,
      proposedDealNameSource: null,
      rawExtraction: { error: error?.message },
    };
  }
}

/**
 * Map document type to checklist key pattern.
 * Returns possible checklist keys this document could satisfy.
 */
export function mapDocTypeToChecklistKeys(
  docType: DocumentType,
  taxYear: number | null
): string[] {
  const keys: string[] = [];

  switch (docType) {
    case "IRS_BUSINESS":
      keys.push("IRS_BUSINESS_3Y", "IRS_BUSINESS_2Y", "BTR", "BTR_2Y", "TAX_RETURNS");
      break;
    case "IRS_PERSONAL":
      keys.push("IRS_PERSONAL_3Y", "IRS_PERSONAL_2Y", "PTR", "PTR_2Y", "TAX_RETURNS");
      break;
    case "PFS":
      keys.push("PFS_CURRENT", "SBA_413", "PFS", "PERSONAL_FINANCIAL_STATEMENT");
      break;
    case "RENT_ROLL":
      keys.push("RENT_ROLL");
      break;
    case "T12":
      keys.push("PROPERTY_T12", "FIN_STMT_PL_YTD", "T12", "OPERATING_STATEMENT");
      break;
    case "BANK_STATEMENT":
      keys.push("BANK_STMT_3M", "BANK_STATEMENTS", "BANK_STATEMENT_3MO");
      break;
    case "ARTICLES":
      keys.push("ARTICLES", "FORMATION_DOCS", "ENTITY_DOCS");
      break;
    case "OPERATING_AGREEMENT":
      keys.push("OPERATING_AGREEMENT", "ENTITY_DOCS");
      break;
    case "BYLAWS":
      keys.push("BYLAWS", "ENTITY_DOCS");
      break;
    case "BUSINESS_LICENSE":
      keys.push("BUSINESS_LICENSE", "LICENSE");
      break;
    case "LEASE":
      keys.push("LEASES_TOP", "LEASE", "COMMERCIAL_LEASE");
      break;
    case "INSURANCE":
      keys.push("PROPERTY_INSURANCE", "INSURANCE", "INSURANCE_CERT", "COI");
      break;
    case "APPRAISAL":
      keys.push("APPRAISAL_IF_AVAILABLE", "APPRAISAL");
      break;
    case "ENVIRONMENTAL":
      keys.push("ENVIRONMENTAL", "PHASE_1", "ESA");
      break;
    case "SCHEDULE_OF_RE":
      keys.push("SCHEDULE_OF_RE", "RE_SCHEDULE");
      break;
    case "K1":
      keys.push("K1", "SCHEDULE_K1");
      break;
    case "W2":
      keys.push("W2", "W2_2Y");
      break;
    case "1099":
      keys.push("1099");
      break;
    case "DRIVERS_LICENSE":
      keys.push("ID", "DRIVERS_LICENSE");
      break;
  }

  return keys;
}
