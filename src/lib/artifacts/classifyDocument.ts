/**
 * 3-Tier Document Classification for Magic Intake.
 *
 * Decision order:
 *  A. DocAI — if Document AI has already processed this document and
 *     produced a type label with confidence ≥ 0.75, trust it.
 *  B. Rules — deterministic text/filename anchors (IRS forms, keywords).
 *     No API call. Returns result with confidence ≥ 0.60.
 *  C. Gemini — LLM fallback via Google Vertex AI. Only called when
 *     DocAI and rules cannot classify.
 *  D. Fallback — if Gemini also fails, use best-effort rules result
 *     (even if low-confidence) or return OTHER. Never throws.
 */

import "server-only";
import { VertexAI } from "@google-cloud/vertexai";
import { ensureGcpAdcBootstrap, getVertexAuthOptions } from "@/lib/gcpAdcBootstrap";
import { classifyByRules, type RulesClassificationResult } from "./classifyByRules";

// ---------------------------------------------------------------------------
// Document type enum
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Classification types
// ---------------------------------------------------------------------------

export type ClassificationTier = "docai" | "rules" | "gemini" | "fallback";

export type DocAiSignals = {
  processorType?: string;
  docTypeLabel?: string;
  docTypeConfidence?: number;
  entities?: Array<{ type: string; mentionText: string; confidence: number }>;
};

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
  /** IRS form numbers visible in the document (e.g., ["1040", "Schedule C"]) */
  formNumbers: string[] | null;
  /** Issuing entity (e.g., "IRS", "Bank of America") */
  issuer: string | null;
  /** Document reporting period start (ISO date string) */
  periodStart: string | null;
  /** Document reporting period end (ISO date string) */
  periodEnd: string | null;
  /** Which classification tier produced this result */
  tier?: ClassificationTier;
  /** Model/method identifier (e.g. "docai:TAX_PROCESSOR", "rules:rules_form", "gemini-2.0-flash") */
  model?: string;
};

// ---------------------------------------------------------------------------
// DocAI label → DocumentType mapping
// ---------------------------------------------------------------------------

const DOCAI_LABEL_MAP: Record<string, DocumentType> = {
  // Google DocAI processor labels (case-insensitive matching done below)
  "tax_return_1040": "IRS_PERSONAL",
  "tax_return_1120": "IRS_BUSINESS",
  "tax_return_1120s": "IRS_BUSINESS",
  "tax_return_1065": "IRS_BUSINESS",
  "1040": "IRS_PERSONAL",
  "1120": "IRS_BUSINESS",
  "1120s": "IRS_BUSINESS",
  "1065": "IRS_BUSINESS",
  "personal_financial_statement": "PFS",
  "rent_roll": "RENT_ROLL",
  "operating_statement": "T12",
  "income_statement": "T12",
  "financial_statement": "T12",
  "balance_sheet": "OTHER",
  "bank_statement": "BANK_STATEMENT",
  "insurance_certificate": "INSURANCE",
  "appraisal": "APPRAISAL",
  "lease": "LEASE",
  "k1": "K1",
  "schedule_k1": "K1",
  "w2": "W2",
  "1099": "1099",
};

function mapDocAiLabelToDocType(label: string): DocumentType | null {
  const normalized = label.toLowerCase().replace(/[\s-]+/g, "_");
  return DOCAI_LABEL_MAP[normalized] ?? null;
}

// ---------------------------------------------------------------------------
// Gemini prompt
// ---------------------------------------------------------------------------

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
  "proposed_deal_name_source": "1120s_header",
  "form_numbers": ["1120S"],
  "issuer": "IRS",
  "period_start": "2023-01-01",
  "period_end": "2023-12-31"
}

Rules:
- confidence: 0.0 to 1.0 (0.85+ for high confidence)
- tax_year: null if not applicable or not found
- entity_name: The business or individual name from the document
- entity_type: "business" or "personal" or null
- proposed_deal_name: If this is a tax return with a clear business name, suggest it as deal name
- proposed_deal_name_source: Where the name came from (e.g., "schedule_c", "1120s_header", "1040_header")
- form_numbers: Array of IRS form numbers visible in the document (e.g., ["1040"], ["1120S", "Schedule K-1"]). null if not a tax/IRS document.
- issuer: The issuing entity (e.g., "IRS" for tax returns, bank name for statements, insurance company). null if unknown.
- period_start: Start date of the document's reporting period in YYYY-MM-DD format. null if not applicable.
- period_end: End date of the document's reporting period in YYYY-MM-DD format. null if not applicable.

Be precise. If unsure, lower the confidence. For tax documents, always try to extract the tax year and form numbers.`;

// ---------------------------------------------------------------------------
// Gemini Vertex AI helpers (mirrors runGeminiOcrJob.ts pattern)
// ---------------------------------------------------------------------------

function getGoogleProjectId(): string {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCS_PROJECT_ID ||
    process.env.GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "Missing Google Cloud project id. Set GOOGLE_CLOUD_PROJECT (recommended) or GOOGLE_PROJECT_ID.",
    );
  }
  return projectId;
}

function getGoogleLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_REGION || "us-central1";
}

function getClassifierModel(): string {
  return process.env.GEMINI_CLASSIFIER_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash";
}

// ---------------------------------------------------------------------------
// Helper: Build ClassificationResult from rules result
// ---------------------------------------------------------------------------

function rulesResultToClassification(
  rulesResult: RulesClassificationResult,
): ClassificationResult {
  return {
    docType: rulesResult.docType,
    confidence: rulesResult.confidence,
    reason: rulesResult.reason,
    taxYear: rulesResult.taxYear,
    entityName: null,
    entityType: rulesResult.entityType,
    proposedDealName: null,
    proposedDealNameSource: null,
    rawExtraction: { rules_tier: rulesResult.tier },
    formNumbers: rulesResult.formNumbers,
    issuer: rulesResult.docType === "IRS_PERSONAL" || rulesResult.docType === "IRS_BUSINESS" || rulesResult.docType === "K1"
      ? "IRS"
      : null,
    periodStart: null,
    periodEnd: null,
    tier: "rules",
    model: `rules:${rulesResult.tier}`,
  };
}

// ---------------------------------------------------------------------------
// Classify (3-tier)
// ---------------------------------------------------------------------------

/**
 * Classify a document using the 3-tier system:
 * A. DocAI signals (if available and high confidence)
 * B. Rules-based (text/filename anchors)
 * C. Gemini LLM fallback
 *
 * Never throws — returns best-effort result on any failure.
 */
export async function classifyDocument(
  documentText: string,
  filename: string,
  mimeType: string | null,
  docAi?: DocAiSignals,
): Promise<ClassificationResult> {

  // ── Tier A: DocAI ──────────────────────────────────────────────────────
  if (docAi?.docTypeLabel && (docAi.docTypeConfidence ?? 0) >= 0.75) {
    const mappedType = mapDocAiLabelToDocType(docAi.docTypeLabel);
    if (mappedType) {
      // Also run rules to pick up form numbers and tax year
      const rulesResult = classifyByRules(documentText, filename);

      return {
        docType: mappedType,
        confidence: docAi.docTypeConfidence ?? 0.80,
        reason: `DocAI processor classified as "${docAi.docTypeLabel}" (confidence ${docAi.docTypeConfidence})`,
        taxYear: rulesResult?.taxYear ?? null,
        entityName: null,
        entityType: rulesResult?.entityType ?? null,
        proposedDealName: null,
        proposedDealNameSource: null,
        rawExtraction: {
          docai_label: docAi.docTypeLabel,
          docai_confidence: docAi.docTypeConfidence,
          docai_processor: docAi.processorType,
        },
        formNumbers: rulesResult?.formNumbers ?? null,
        issuer: null,
        periodStart: null,
        periodEnd: null,
        tier: "docai",
        model: `docai:${docAi.processorType ?? "unknown"}`,
      };
    }
  }

  // ── Tier B: Rules-based ────────────────────────────────────────────────
  const rulesResult = classifyByRules(documentText, filename);
  if (rulesResult && rulesResult.confidence >= 0.65) {
    return rulesResultToClassification(rulesResult);
  }

  // ── Tier C: Gemini LLM ────────────────────────────────────────────────
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
    await ensureGcpAdcBootstrap();
    const googleAuthOptions = await getVertexAuthOptions();

    const vertexAI = new VertexAI({
      project: getGoogleProjectId(),
      location: getGoogleLocation(),
      ...(googleAuthOptions ? { googleAuthOptions: googleAuthOptions as any } : {}),
    });

    const modelName = getClassifierModel();
    const model = vertexAI.getGenerativeModel({ model: modelName });

    const resp = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: CLASSIFICATION_PROMPT + "\n\n" + userMessage }],
        },
      ],
    });

    const parts = (resp as any)?.response?.candidates?.[0]?.content?.parts ?? [];
    const textRaw = parts
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("");

    if (!textRaw) {
      throw new Error("No text response from Gemini");
    }

    // Parse JSON response
    const jsonMatch = textRaw.match(/\{[\s\S]*\}/);
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
      formNumbers: Array.isArray(parsed.form_numbers)
        ? parsed.form_numbers.map(String)
        : null,
      issuer: parsed.issuer ? String(parsed.issuer) : null,
      periodStart: parsed.period_start ? String(parsed.period_start) : null,
      periodEnd: parsed.period_end ? String(parsed.period_end) : null,
      tier: "gemini",
      model: modelName,
    };
  } catch (error: any) {
    console.error("[classifyDocument] Gemini classification failed", {
      filename,
      error: error?.message,
    });

    // ── Tier D: Fallback — prefer rules result (even low-confidence) over bare OTHER
    if (rulesResult) {
      console.log("[classifyDocument] Falling back to rules result after Gemini failure", {
        filename,
        rulesDocType: rulesResult.docType,
        rulesConfidence: rulesResult.confidence,
      });
      const result = rulesResultToClassification(rulesResult);
      result.tier = "fallback";
      result.model = `fallback:${rulesResult.tier}`;
      result.reason = `${rulesResult.reason} (Gemini unavailable: ${error?.message})`;
      return result;
    }

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
      formNumbers: null,
      issuer: null,
      periodStart: null,
      periodEnd: null,
      tier: "fallback",
      model: "fallback:none",
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
      // Add year-specific key first if taxYear is known (e.g., IRS_BUSINESS_2024)
      if (taxYear && taxYear >= 2000 && taxYear <= 2100) {
        keys.push(`IRS_BUSINESS_${taxYear}`);
      }
      // Also add legacy keys for backward compatibility
      keys.push("IRS_BUSINESS_3Y", "IRS_BUSINESS_2Y", "BTR", "BTR_2Y", "TAX_RETURNS");
      break;
    case "IRS_PERSONAL":
      // Add year-specific key first if taxYear is known (e.g., IRS_PERSONAL_2024)
      if (taxYear && taxYear >= 2000 && taxYear <= 2100) {
        keys.push(`IRS_PERSONAL_${taxYear}`);
      }
      // Also add legacy keys for backward compatibility
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
