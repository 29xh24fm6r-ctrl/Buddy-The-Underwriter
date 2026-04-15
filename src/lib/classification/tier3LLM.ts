/**
 * Tier 3 — Domain-Specialized LLM Escalation
 *
 * Used ONLY when Tier 1 + Tier 2 fail to produce accepted classification.
 * Reuses existing Gemini VertexAI pattern from classifyDocument.ts.
 *
 * Enhancements over generic Gemini prompt:
 * - Explicit confusion pair guidance
 * - T12 prohibition
 * - Required confusion_candidates in output
 * - Human-curated confusion examples injection
 */

import "server-only";
import { VertexAI } from "@google-cloud/vertexai";
import {
  ensureGcpAdcBootstrap,
  getVertexAuthOptions,
} from "@/lib/gcpAdcBootstrap";
import type { NormalizedDocument, Tier3Result, EvidenceItem } from "./types";

// ---------------------------------------------------------------------------
// Config
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
  return (
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_CLOUD_REGION ||
    "us-central1"
  );
}

function getClassifierModel(): string {
  return (
    process.env.GEMINI_CLASSIFIER_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash"
  );
}

// ---------------------------------------------------------------------------
// Confusion Examples (human-curated)
// ---------------------------------------------------------------------------

let _confusionExamplesCache: string | null = null;

function loadConfusionExamples(): string {
  if (_confusionExamplesCache !== null) return _confusionExamplesCache;

  try {
    // Dynamic import of JSON at runtime
    const examples = require("./confusionExamples.json") as Array<{
      original_type: string;
      corrected_type: string;
      signals: string[];
    }>;

    if (!Array.isArray(examples) || examples.length === 0) {
      _confusionExamplesCache = "";
      return "";
    }

    const lines = examples.map(
      (e) =>
        `- Was classified as ${e.original_type}, actually ${e.corrected_type}. Signals: ${e.signals.join("; ")}`,
    );

    _confusionExamplesCache =
      "\n\nHISTORICAL MISCLASSIFICATION EXAMPLES (learn from these):\n" +
      lines.join("\n");
    return _confusionExamplesCache;
  } catch {
    _confusionExamplesCache = "";
    return "";
  }
}

// ---------------------------------------------------------------------------
// Domain-Specialized Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a document classifier for a commercial bank underwriting pipeline.
Given a document (text), classify it into exactly one doc_type.
Return ONLY valid JSON matching the schema below.

DOCUMENT TYPES (choose the most specific match):
- IRS_BUSINESS: Business tax returns (Form 1120, 1120S, 1065 and schedules — NOT K-1)
- IRS_PERSONAL: Personal tax returns (Form 1040 and schedules — NOT K-1, NOT W-2, NOT 1099)
- PFS: Personal Financial Statement / SBA Form 413 — an INDIVIDUAL GUARANTOR'S personal assets, liabilities, and net worth. NOT a business balance sheet.
- RENT_ROLL: Rent roll / tenant list showing tenants, units, rents, expirations
- INCOME_STATEMENT: Income statement, P&L, operating statement, monthly financials
- BALANCE_SHEET: Balance sheet / statement of financial position for a BUSINESS ENTITY (not a person)
- BANK_STATEMENT: Bank account statement with transactions
- K1: Schedule K-1 (from 1065, 1120-S, or trust)
- W2: W-2 wage and tax statement
- 1099: 1099 form (any variant)
- DRIVERS_LICENSE: Government-issued photo ID
- ARTICLES: Articles of incorporation/organization
- OPERATING_AGREEMENT: LLC operating agreement
- INSURANCE: Insurance certificate or policy
- APPRAISAL: Property appraisal report
- COMMERCIAL_LEASE: Commercial lease agreement, lease amendment, NNN lease, or office/retail lease with a rent schedule and defined Landlord/Tenant parties
- CREDIT_MEMO: Internal bank credit memo, loan worksheet, officer narrative, or prior-approved credit package. Contains DSCR calculations, collateral descriptions, and a banker recommendation/approval section.
- OTHER: Cannot determine type

CRITICAL CONFUSION PAIRS (pay careful attention to these):

1. Form 1065 vs Schedule K-1:
   - Form 1065 is the PARTNERSHIP RETURN (IRS_BUSINESS)
   - Schedule K-1 is a PARTNER'S SHARE statement (K1)
   - "Schedule K-1 (Form 1065)" → K1, not IRS_BUSINESS

2. PFS vs BALANCE_SHEET:
   - PFS = personal individual guarantor document. Has: personal real estate, vehicles, retirement accounts, life insurance cash value, net worth, personal income/expenses. Titled "Personal Financial Statement."
   - BALANCE_SHEET = business entity document. Has: business equipment, accounts receivable, inventory, retained earnings. Titled with a company name.
   - KEY: A PFS may contain a section called "Balance Sheet" or "Statement of Financial Condition" — this does NOT make it a BALANCE_SHEET. Look at the overall document.
   - If the document mentions an individual by name with personal assets → PFS
   - If the document mentions a company name with business assets → BALANCE_SHEET

3. CREDIT_MEMO vs BALANCE_SHEET / INCOME_STATEMENT:
   - Credit memos contain financial analysis tables (income, expenses, assets) but that is NOT the document's primary purpose
   - Credit memos are identified by: "Loan Worksheet", "Officer Narrative", "DSCR", "Debt Service Coverage Ratio", "Collateral Description", "Recommendation", banker approval signatures
   - If you see DSCR calculations AND a banker recommendation → CREDIT_MEMO
   - Do not let the presence of financial tables override these primary signals

4. COMMERCIAL_LEASE vs OTHER:
   - Commercial leases have: defined Landlord and Tenant parties, a rent schedule with dollar amounts per period, commencement and expiration dates, lease term in months
   - "First Amendment to Lease", "NNN", "plus utilities" are strong lease signals
   - If a document has a rent table and defined Landlord/Tenant → COMMERCIAL_LEASE

5. YTD P&L vs Annual P&L:
   - Both → INCOME_STATEMENT. Not different types.

6. Bank Statement vs Transaction Export:
   - Both → BANK_STATEMENT

IMPORTANT: Do NOT classify any document as T12 or LEASE. Use INCOME_STATEMENT for P&L. Use COMMERCIAL_LEASE for leases.

CONFIDENCE RULES:
- 0.85+: High confidence (clear signals)
- 0.60-0.84: Moderate (some ambiguity)
- Below 0.60: Low (unclear)

Required JSON output:
{
  "doc_type": "IRS_BUSINESS",
  "confidence": 0.95,
  "reasoning": "Form 1120S visible on page 1",
  "anchor_evidence": ["Form 1120S header", "Tax year 2023"],
  "confusion_candidates": ["IRS_PERSONAL"],
  "tax_year": 2023,
  "entity_name": "ABC Corp",
  "entity_type": "business",
  "form_numbers": ["1120S"],
  "issuer": "IRS",
  "period_start": "2023-01-01",
  "period_end": "2023-12-31"
}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run Tier 3 domain-specialized LLM classification.
 *
 * Called only when Tier 1 + Tier 2 fail.
 * Uses Gemini via VertexAI with confusion pair guidance.
 */
export async function runTier3LLM(
  doc: NormalizedDocument,
): Promise<Tier3Result> {
  const modelName = getClassifierModel();

  const userMessage = `Filename: ${doc.filename}
MIME type: ${doc.mimeType || "unknown"}

Document content (first two pages):
---
${doc.firstTwoPagesText}
---

Classify this document and extract key information. Respond with JSON only.`;

  const confusionExamples = loadConfusionExamples();
  const fullPrompt = SYSTEM_PROMPT + confusionExamples;

  try {
    await ensureGcpAdcBootstrap();
    const googleAuthOptions = await getVertexAuthOptions();

    const vertexAI = new VertexAI({
      project: getGoogleProjectId(),
      location: getGoogleLocation(),
      ...(googleAuthOptions
        ? { googleAuthOptions: googleAuthOptions as any }
        : {}),
    });

    const model = vertexAI.getGenerativeModel({ model: modelName });

    const resp = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: fullPrompt + "\n\n" + userMessage }],
        },
      ],
    });

    const parts =
      (resp as any)?.response?.candidates?.[0]?.content?.parts ?? [];
    const textRaw = parts
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("");

    if (!textRaw) {
      throw new Error("No text response from Gemini");
    }

    // Parse JSON response
    const jsonMatch = textRaw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in Gemini response — rejected");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate doc_type — T12 is not allowed from LLM
    let docType = String(parsed.doc_type || "OTHER");
    if (docType === "T12") {
      docType = "INCOME_STATEMENT"; // Enforce T12 prohibition
    }

    const confidence = Math.min(
      1,
      Math.max(0, Number(parsed.confidence) || 0.5),
    );

    const evidence: EvidenceItem[] = (
      Array.isArray(parsed.anchor_evidence) ? parsed.anchor_evidence : []
    ).map((e: string) => ({
      type: "keyword_match" as const,
      anchorId: "tier3_llm",
      matchedText: String(e),
      confidence,
    }));

    return {
      matched: confidence >= 0.40, // LLM always "matches" unless very low
      docType,
      confidence,
      reason: String(parsed.reasoning || ""),
      confusionCandidates: Array.isArray(parsed.confusion_candidates)
        ? parsed.confusion_candidates.map(String)
        : [],
      evidence,
      taxYear: parsed.tax_year ? Number(parsed.tax_year) : null,
      entityName: parsed.entity_name ? String(parsed.entity_name) : null,
      entityType:
        parsed.entity_type === "business" || parsed.entity_type === "personal"
          ? parsed.entity_type
          : null,
      formNumbers: Array.isArray(parsed.form_numbers)
        ? parsed.form_numbers.map(String)
        : null,
      issuer: parsed.issuer ? String(parsed.issuer) : null,
      periodStart: parsed.period_start ? String(parsed.period_start) : null,
      periodEnd: parsed.period_end ? String(parsed.period_end) : null,
      model: modelName,
    };
  } catch (error: any) {
    console.error("[tier3LLM] Gemini classification failed", {
      filename: doc.filename,
      error: error?.message,
    });

    return {
      matched: false,
      docType: "OTHER",
      confidence: 0.1,
      reason: `Tier 3 LLM failed: ${error?.message}`,
      confusionCandidates: [],
      evidence: [],
      taxYear: null,
      entityName: null,
      entityType: null,
      formNumbers: null,
      issuer: null,
      periodStart: null,
      periodEnd: null,
      model: modelName,
    };
  }
}
