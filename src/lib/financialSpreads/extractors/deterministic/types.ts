import type { ExtractionResult } from "../shared";

/**
 * Extraction path taken by the deterministic extractor.
 *
 * OBSERVATIONAL ONLY — must not change downstream spread logic,
 * validator thresholds, or slot binding rules.
 *
 *  gemini_structured — Parsed from Gemini Flash structured assist JSON entities
 *  gemini_table      — Parsed from Gemini Flash structured assist table extraction
 *  ocr_regex         — Parsed from OCR text using regex patterns
 *  gemini_primary    — Extracted directly by Gemini 2.0 Flash as primary extractor
 */
export type ExtractionPath = "gemini_structured" | "ocr_regex" | "gemini_table" | "ocr_generic_scan" | "gemini_primary";

export type DeterministicExtractorArgs = {
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
  /** Advisory structured JSON from Gemini Flash assist (never canonical truth) */
  structuredJson?: unknown;
  /** Owner entity ID for personal docs (PFS, personal income) */
  ownerEntityId?: string | null;
  /** Document year from deal_documents.doc_year — fallback when OCR date extraction fails */
  docYear?: number | null;
};

export type DeterministicExtractionResult = ExtractionResult & {
  extractionPath: ExtractionPath;
  /** Number of fact slots the extractor attempted to fill (for zero-fact detection) */
  factsAttempted: number;
};

/** Line item from a pure deterministic extractor (no DB writes). */
export type PureLineItem = {
  key: string;
  value: number | string | boolean;
  period: string | null;
  snippet: string | null;
};

/** Result from a pure deterministic extractor — returns items, no DB interaction. */
export type PureDeterministicResult = {
  ok: boolean;
  items: PureLineItem[];
  extractionPath: ExtractionPath;
  factsAttempted: number;
};
