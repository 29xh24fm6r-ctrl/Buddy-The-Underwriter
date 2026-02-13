import type { ExtractionResult } from "../shared";

/**
 * Extraction path taken by the deterministic extractor.
 *
 *  docai_structured — Parsed from Document AI's structured JSON entities
 *  docai_table      — Parsed from Document AI's table extraction
 *  ocr_regex        — Parsed from OCR text using regex patterns
 */
export type ExtractionPath = "docai_structured" | "ocr_regex" | "docai_table" | "ocr_generic_scan";

export type DeterministicExtractorArgs = {
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
  /** Document AI structured JSON from document_extracts.fields_json.structuredJson */
  docAiJson?: unknown;
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
