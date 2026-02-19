/**
 * Document Normalization Layer — Phase 1
 *
 * Pure preprocessing. No classification logic.
 * Eliminates pre-classification noise that causes false negatives.
 */

import type { NormalizedDocument } from "./types";
import { extractDetectedYears } from "./textUtils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Approximate chars per page for page count estimation */
const CHARS_PER_PAGE = 3000;

/** Max chars for first-page extraction */
const FIRST_PAGE_CHARS = 3000;

/** Max chars for first-two-pages extraction */
const FIRST_TWO_PAGES_CHARS = 6000;

// ---------------------------------------------------------------------------
// Page boundary detection
// ---------------------------------------------------------------------------

/**
 * Common form-feed / page-break markers in OCR text.
 * PDF extractors often insert these between pages.
 */
const PAGE_BREAK_PATTERNS = [
  /\f/g, // form-feed character
  /\n-{3,}\s*\n/g, // horizontal rule separators
  /\n\s*Page\s+\d+\s*(?:of\s+\d+)?\s*\n/gi, // "Page 1 of 3"
];

function estimatePageCount(text: string): number {
  // Try form-feed first (most reliable)
  const formFeeds = (text.match(/\f/g) ?? []).length;
  if (formFeeds > 0) return formFeeds + 1;

  // Try page markers
  const pageMarkers = (
    text.match(/\bPage\s+(\d+)\s*(?:of\s+(\d+))?/gi) ?? []
  ).length;
  if (pageMarkers > 1) return pageMarkers;

  // Fallback: char-length heuristic
  return Math.max(1, Math.ceil(text.length / CHARS_PER_PAGE));
}

function extractFirstPage(text: string): string {
  // Try form-feed boundary
  const ffIdx = text.indexOf("\f");
  if (ffIdx > 0 && ffIdx <= FIRST_PAGE_CHARS * 1.5) {
    return text.slice(0, ffIdx).trim();
  }
  return text.slice(0, FIRST_PAGE_CHARS);
}

function extractFirstTwoPages(text: string): string {
  // Try second form-feed boundary
  const ff1 = text.indexOf("\f");
  if (ff1 > 0) {
    const ff2 = text.indexOf("\f", ff1 + 1);
    if (ff2 > 0 && ff2 <= FIRST_TWO_PAGES_CHARS * 1.5) {
      return text.slice(0, ff2).trim();
    }
    // Only one form-feed — take everything up to it plus next chunk
    return text.slice(0, Math.min(text.length, ff1 + FIRST_PAGE_CHARS)).trim();
  }
  return text.slice(0, FIRST_TWO_PAGES_CHARS);
}

// ---------------------------------------------------------------------------
// Table-like structure detection
// ---------------------------------------------------------------------------

/**
 * Detect if text has table-like structure (tab-delimited or pipe-delimited
 * repeating rows, or multi-column financial data).
 */
function detectTableStructure(text: string): boolean {
  const lines = text.slice(0, FIRST_TWO_PAGES_CHARS).split("\n");

  // Count lines with multiple tab or pipe separators
  let tabularLines = 0;
  for (const line of lines) {
    const tabCount = (line.match(/\t/g) ?? []).length;
    const pipeCount = (line.match(/\|/g) ?? []).length;
    if (tabCount >= 2 || pipeCount >= 2) tabularLines++;
  }

  // If ≥5 lines have tabular structure, it's a table document
  if (tabularLines >= 5) return true;

  // Also check for multi-column year pattern (e.g., "2022  2023  2024")
  const yearRowPattern = /\b20[12]\d\s+20[12]\d\b/;
  if (yearRowPattern.test(text.slice(0, FIRST_TWO_PAGES_CHARS))) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Main normalizer
// ---------------------------------------------------------------------------

/**
 * Normalize a document for classification.
 * Pure function — no side effects, no DB, no API.
 */
export function normalizeDocument(
  artifactId: string,
  text: string,
  filename: string,
  mimeType: string | null,
): NormalizedDocument {
  return {
    artifactId,
    filename,
    mimeType,
    pageCount: estimatePageCount(text),
    firstPageText: extractFirstPage(text),
    firstTwoPagesText: extractFirstTwoPages(text),
    fullText: text,
    detectedYears: extractDetectedYears(text),
    hasTableLikeStructure: detectTableStructure(text),
  };
}
