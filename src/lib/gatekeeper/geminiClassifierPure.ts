/**
 * Gemini Gatekeeper — Pure Utilities
 *
 * Extracted from geminiClassifier.ts so these utilities can be unit tested
 * without pulling in "server-only". Contains:
 * - SYSTEM_PROMPT (exported so the hash function and tests can share one source of truth)
 * - GEMINI_PROMPT_VERSION
 * - getGeminiPromptHash() — hashes full prompt (Spec D1)
 * - getGeminiPromptVersion()
 * - normalizeEntityName() — null/trim/placeholder guard for entity name strings
 * - parseGeminiResult() — JSON → GeminiClassifyResult
 * - GeminiClassifyResult type
 *
 * No "server-only" import here. Anything that needs network or storage access
 * lives in geminiClassifier.ts.
 */

import { createHash } from "crypto";
import type { GatekeeperClassification } from "./types";
import { MODEL_CLASSIFICATION } from "@/lib/ai/models";

export const GEMINI_MODEL = MODEL_CLASSIFICATION;

// ─── Result Type ────────────────────────────────────────────────────────────

export type GeminiClassifyResult = GatekeeperClassification & {
  model: string;
};

// ─── System Prompt ──────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a document classifier for a commercial bank underwriting pipeline.
Given a document (text or image), classify it into exactly one doc_type.
Return ONLY valid JSON matching the provided schema.

CLASSIFICATION RULES:
- BUSINESS_TAX_RETURN: IRS Forms 1120, 1120-S, 1065, and their schedules (NOT K-1)
- PERSONAL_TAX_RETURN: IRS Form 1040 and its schedules (NOT K-1, NOT W-2, NOT 1099)
- W2: W-2 Wage and Tax Statement
- FORM_1099: Any 1099 variant (1099-INT, 1099-DIV, 1099-MISC, 1099-NEC, etc.)
- K1: Schedule K-1 (from 1065, 1120-S, or trust)
- BANK_STATEMENT: Monthly/quarterly bank account statements
- FINANCIAL_STATEMENT: P&L, income statement, balance sheet, T12, interim financials (NOT personal financial statements — see PERSONAL_FINANCIAL_STATEMENT)
- PERSONAL_FINANCIAL_STATEMENT: Personal Financial Statement, SBA Form 413, guarantor statement of assets and liabilities, personal balance sheet listing an individual's net worth. Key signals: guarantor/borrower name with personal assets, personal liabilities, and net worth summary.
- DRIVERS_LICENSE: Government-issued photo ID (driver's license, state ID, passport)
- VOIDED_CHECK: Voided check for direct deposit / ACH setup
- OTHER: Identifiable document that doesn't fit above categories (lease, insurance, appraisal, etc.)
- UNKNOWN: Cannot determine document type with any confidence

CONFIDENCE RULES:
- 0.95-1.00: Certain (form number clearly visible, unambiguous)
- 0.80-0.94: High confidence (strong signals, minor ambiguity)
- 0.60-0.79: Moderate (some ambiguity, partial signals)
- Below 0.60: Low confidence (unclear, barely readable)

TAX YEAR EXTRACTION:
- Extract the tax year FROM the document (calendar year / fiscal year / "for the year ending")
- IGNORE signature date or filing date if they conflict with the tax year
- Return null if tax year cannot be determined

FORM NUMBERS:
- List any IRS/government form numbers found (e.g., ["1120-S", "Schedule K"])

DETECTED SIGNALS:
- has_ein: true if an EIN (XX-XXXXXXX) pattern is visible
- has_ssn: true if a SSN (XXX-XX-XXXX) pattern is visible (even if partially redacted)

ENTITY NAMES:
- business_name: The legal business entity name on the document, if present. For BUSINESS_TAX_RETURN, this is the taxpayer name field on the top of Form 1120/1120-S/1065. For FINANCIAL_STATEMENT and BALANCE_SHEET/INCOME_STATEMENT, this is the company name in the header. For BANK_STATEMENT, this is the account holder if it is a business account. Return null if no business name is visible or if the document is clearly personal-only (W2, PTR, PFS).
- borrower_name: The individual person name on the document, if present. For PERSONAL_TAX_RETURN, the primary filer's name (from Form 1040 name line). For PERSONAL_FINANCIAL_STATEMENT, the individual completing the statement. For W2, the employee name. For DRIVERS_LICENSE, the license holder. Return null if no personal name is visible or if the document is clearly business-only.
- Names should be returned EXACTLY as they appear on the document — do not normalize case, expand abbreviations, or add/remove suffixes (LLC, Inc., Jr., etc.). Do NOT guess or infer.
- Both fields can be populated if the document names both parties (e.g., a joint PTR has borrower_name; a K-1 may have both a business_name and an individual recipient borrower_name).

Respond with ONLY valid JSON matching this exact schema:
{"doc_type": "BUSINESS_TAX_RETURN", "confidence": 0.95, "tax_year": 2024, "reasons": ["Form 1065 visible"], "detected_signals": {"form_numbers": ["1065"], "has_ein": true, "has_ssn": false, "business_name": "Samaritus Management LLC", "borrower_name": null}}`;

// ─── Prompt Version / Hash ──────────────────────────────────────────────────

/**
 * Version string stamped on cache rows and deal_documents.
 *
 * Spec D1 bumps this to v2 alongside the entity-name extraction prompt change.
 * The version bump AND the switch from slicing the first 120 chars to hashing
 * the full prompt together guarantee the cache is busted for every past doc,
 * so subsequent classifications re-hit Gemini and populate business_name /
 * borrower_name on deal_documents.
 */
export const GEMINI_PROMPT_VERSION = "gemini_classifier_v2";

let _geminiPromptHashCache: string | null = null;

/**
 * Deterministic prompt hash for cache keying.
 * Changing the system prompt must change this value to bust the cache.
 *
 * Spec D1 — hashes the FULL prompt, not the first 120 chars. The prior
 * slice(0, 120) approach meant prompt edits below char 120 would silently
 * continue to serve stale cached results. Hashing the full prompt makes
 * cache busting automatic for any future prompt edit, regardless of where
 * in the prompt the edit lands.
 */
export function getGeminiPromptHash(): string {
  if (!_geminiPromptHashCache) {
    _geminiPromptHashCache = createHash("sha256")
      .update(SYSTEM_PROMPT)
      .digest("hex")
      .slice(0, 16);
  }
  return _geminiPromptHashCache;
}

export function getGeminiPromptVersion(): string {
  return GEMINI_PROMPT_VERSION;
}

// ─── Entity Name Normalization ──────────────────────────────────────────────

/**
 * Normalize a raw entity name string from Gemini.
 *
 * - Non-string inputs (undefined, null, numbers, objects) → null.
 * - Trims leading/trailing whitespace.
 * - Coerces the literal strings "null", "none", "n/a", "unknown" (any case) to null.
 * - Rejects strings longer than 200 chars as almost-certainly OCR noise.
 *
 * Exported for unit testing.
 */
export function normalizeEntityName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (/^(null|none|n\/a|unknown)$/i.test(trimmed)) return null;
  if (trimmed.length > 200) return null;
  return trimmed;
}

// ─── Response Parser ────────────────────────────────────────────────────────

export function parseGeminiResult(text: string): GeminiClassifyResult | null {
  try {
    const parsed = JSON.parse(text);
    return {
      doc_type: parsed.doc_type ?? "UNKNOWN",
      confidence: Number(parsed.confidence ?? 0.5),
      tax_year: parsed.tax_year ?? null,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      detected_signals: {
        form_numbers: Array.isArray(parsed.detected_signals?.form_numbers)
          ? parsed.detected_signals.form_numbers
          : [],
        has_ein: Boolean(parsed.detected_signals?.has_ein),
        has_ssn: Boolean(parsed.detected_signals?.has_ssn),
        business_name: normalizeEntityName(parsed.detected_signals?.business_name),
        borrower_name: normalizeEntityName(parsed.detected_signals?.borrower_name),
      },
      model: GEMINI_MODEL,
    };
  } catch {
    return null;
  }
}
