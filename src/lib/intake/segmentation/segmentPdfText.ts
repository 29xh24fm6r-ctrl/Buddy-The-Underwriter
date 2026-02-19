/**
 * PDF Segmentation v1.2 — Pure Module
 *
 * Splits multi-form PDFs into independent segments for individual classification.
 * Pure function — no server-only, no DB, no IO, no randomness.
 *
 * Segmentation changes input granularity only, never matching rules.
 * Each segment independently passes through the full pipeline.
 */

import type {
  SegmentAnchor,
  SegmentAnchorType,
  PdfSegment,
  SegmentationResult,
} from "./types";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type ParsedPage = {
  pageNumber: number;
  text: string;
  startOffset: number;
  endOffset: number;
};

type AnchorPattern = {
  type: SegmentAnchorType;
  pattern: RegExp;
  confidence: number;
  /** Unique label used for "distinct form type" comparison */
  formLabel: string;
};

// ---------------------------------------------------------------------------
// Anchor patterns — defined inline (NO imports from tier1Anchors)
// ---------------------------------------------------------------------------

const STRONG_ANCHORS: AnchorPattern[] = [
  // IRS form headers (confidence 0.95)
  {
    type: "irs_form_header",
    pattern: /Form\s+1040(?:-?SR|-?NR)?\b/i,
    confidence: 0.95,
    formLabel: "1040",
  },
  {
    type: "irs_form_header",
    pattern: /Form\s+1120(?:-?S)?\b/i,
    confidence: 0.95,
    formLabel: "1120",
  },
  {
    type: "irs_form_header",
    pattern: /Form\s+1065\b/i,
    confidence: 0.95,
    formLabel: "1065",
  },
  {
    type: "irs_form_header",
    pattern: /Schedule\s+K-?1\b/i,
    confidence: 0.95,
    formLabel: "K-1",
  },
  {
    type: "irs_form_header",
    pattern: /Form\s+990(?:-?EZ|-?PF)?\b/i,
    confidence: 0.95,
    formLabel: "990",
  },
  {
    type: "irs_form_header",
    pattern: /Form\s+1099\b/i,
    confidence: 0.95,
    formLabel: "1099",
  },
  // W-2 wage and tax statement (confidence 0.95)
  // Common in 1040 + W-2 bundles — unambiguously distinct from 1040
  {
    type: "irs_form_header",
    pattern: /Form\s+W-?2\b/i,
    confidence: 0.95,
    formLabel: "W-2",
  },
  {
    type: "irs_form_header",
    pattern: /W-?2\s+Wage\s+and\s+Tax\b/i,
    confidence: 0.95,
    formLabel: "W-2",
  },
  // SBA form headers (confidence 0.92)
  {
    type: "sba_form_header",
    pattern: /SBA\s+Form\s+1919\b/i,
    confidence: 0.92,
    formLabel: "SBA-1919",
  },
  {
    type: "sba_form_header",
    pattern: /SBA\s+Form\s+413\b/i,
    confidence: 0.92,
    formLabel: "SBA-413",
  },
];

const WEAK_ANCHORS: AnchorPattern[] = [
  {
    type: "financial_header",
    pattern: /Balance\s+Sheet/i,
    confidence: 0.70,
    formLabel: "BALANCE_SHEET",
  },
  {
    type: "financial_header",
    pattern: /(?:Income\s+Statement|Profit\s+and\s+Loss|Profit\s*&\s*Loss|\bP\s*&?\s*L\b)/i,
    confidence: 0.70,
    formLabel: "INCOME_STATEMENT",
  },
  {
    type: "financial_header",
    pattern: /Statement\s+of\s+Cash\s+Flows/i,
    confidence: 0.70,
    formLabel: "CASH_FLOW",
  },
];

const ALL_ANCHORS: AnchorPattern[] = [...STRONG_ANCHORS, ...WEAK_ANCHORS];

// ---------------------------------------------------------------------------
// Page parsing
// ---------------------------------------------------------------------------

/** Gemini OCR [Page N] marker — must be on its own line */
const PAGE_MARKER_RE = /^\[Page\s+(\d+)\]\s*$/gm;

/**
 * Parse text into pages using [Page N] markers, form-feed, or single-page fallback.
 */
function parsePages(text: string): ParsedPage[] {
  // Strategy 1: [Page N] markers
  const markerPages = parsePagesFromMarkers(text);
  if (markerPages.length > 0) return markerPages;

  // Strategy 2: form-feed characters
  const ffPages = parsePagesFromFormFeed(text);
  if (ffPages.length > 1) return ffPages;

  // Strategy 3: single page (entire text)
  return [
    {
      pageNumber: 1,
      text,
      startOffset: 0,
      endOffset: text.length,
    },
  ];
}

function parsePagesFromMarkers(text: string): ParsedPage[] {
  const pages: ParsedPage[] = [];
  const markers: { pageNumber: number; offset: number; markerEnd: number }[] = [];

  // Reset regex state
  PAGE_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAGE_MARKER_RE.exec(text)) !== null) {
    markers.push({
      pageNumber: parseInt(m[1], 10),
      offset: m.index,
      markerEnd: m.index + m[0].length,
    });
  }

  if (markers.length === 0) return [];

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const nextOffset = i + 1 < markers.length ? markers[i + 1].offset : text.length;
    // Page text starts after the marker line (include the newline after marker)
    const pageTextStart = marker.markerEnd;
    // Remove leading newline right after marker if present
    const startIdx =
      text[pageTextStart] === "\n" ? pageTextStart + 1 : pageTextStart;
    pages.push({
      pageNumber: marker.pageNumber,
      text: text.slice(startIdx, nextOffset),
      startOffset: marker.offset,
      endOffset: nextOffset,
    });
  }

  return pages;
}

function parsePagesFromFormFeed(text: string): ParsedPage[] {
  const parts = text.split("\f");
  if (parts.length <= 1) return [];

  const pages: ParsedPage[] = [];
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    pages.push({
      pageNumber: i + 1,
      text: part,
      startOffset: offset,
      endOffset: offset + part.length,
    });
    // +1 for the \f character itself
    offset += part.length + 1;
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Anchor detection
// ---------------------------------------------------------------------------

function detectAnchorsOnPage(page: ParsedPage): SegmentAnchor[] {
  const anchors: SegmentAnchor[] = [];

  for (const ap of ALL_ANCHORS) {
    const match = ap.pattern.exec(page.text);
    if (match) {
      anchors.push({
        type: ap.type,
        pageNumber: page.pageNumber,
        offset: page.startOffset + match.index,
        matchedText: match[0],
        confidence: ap.confidence,
      });
    }
  }

  return anchors;
}

/**
 * Determine the formLabel for a SegmentAnchor by re-testing against patterns.
 */
function anchorFormLabel(anchor: SegmentAnchor): string {
  for (const ap of ALL_ANCHORS) {
    if (ap.type === anchor.type && ap.pattern.test(anchor.matchedText)) {
      return ap.formLabel;
    }
  }
  return anchor.matchedText;
}

function isStrongAnchor(anchor: SegmentAnchor): boolean {
  return anchor.confidence >= 0.90;
}

// ---------------------------------------------------------------------------
// Segment grouping
// ---------------------------------------------------------------------------

type PageWithAnchors = {
  page: ParsedPage;
  anchors: SegmentAnchor[];
  hasStrongAnchor: boolean;
};

function groupIntoSegments(
  pagesWithAnchors: PageWithAnchors[],
): { pages: PageWithAnchors[] }[] {
  if (pagesWithAnchors.length === 0) return [];

  // Find pages that have strong anchors — these are boundary pages
  const boundaryIndices: number[] = [];
  for (let i = 0; i < pagesWithAnchors.length; i++) {
    if (pagesWithAnchors[i].hasStrongAnchor) {
      boundaryIndices.push(i);
    }
  }

  // 0 or 1 strong anchor → single segment
  if (boundaryIndices.length <= 1) {
    return [{ pages: pagesWithAnchors }];
  }

  // Multiple strong anchors → split at boundaries
  const groups: { pages: PageWithAnchors[] }[] = [];
  for (let b = 0; b < boundaryIndices.length; b++) {
    const start = boundaryIndices[b];
    const end =
      b + 1 < boundaryIndices.length
        ? boundaryIndices[b + 1]
        : pagesWithAnchors.length;
    groups.push({ pages: pagesWithAnchors.slice(start, end) });
  }

  // Pages before the first strong anchor boundary belong to a leading segment
  if (boundaryIndices[0] > 0) {
    const leadingPages = pagesWithAnchors.slice(0, boundaryIndices[0]);
    // Prepend as its own segment only if it has content
    const hasContent = leadingPages.some((p) => p.page.text.trim().length > 0);
    if (hasContent) {
      groups.unshift({ pages: leadingPages });
    } else {
      // Merge empty leading pages into the first boundary segment
      groups[0].pages = [...leadingPages, ...groups[0].pages];
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

function computeMultiFormConfidence(
  allAnchors: SegmentAnchor[],
  segmentCount: number,
): number {
  const strongAnchors = allAnchors.filter(isStrongAnchor);
  const weakAnchors = allAnchors.filter((a) => !isStrongAnchor(a));

  if (strongAnchors.length === 0 && weakAnchors.length === 0) {
    return 0.0;
  }

  if (strongAnchors.length >= 2) {
    // Check if they are distinct form types
    const formLabels = new Set(strongAnchors.map(anchorFormLabel));
    if (formLabels.size >= 2) {
      // Distinct strong anchors (different form types)
      return 0.92;
    }
    // Same form type repeated (e.g., two Form 1040 for different years)
    return 0.85;
  }

  if (strongAnchors.length === 1 && weakAnchors.length >= 1) {
    // 1 strong + >= 1 weak in different page regions
    return 0.75;
  }

  if (weakAnchors.length >= 1) {
    // Only weak anchors
    return 0.55;
  }

  // Single strong anchor
  return 0.0;
}

// ---------------------------------------------------------------------------
// Segment text assembly
// ---------------------------------------------------------------------------

/**
 * Build the text for a segment from its pages, preserving all original
 * characters. We concatenate the full page regions (including markers)
 * so the union of segment texts reconstructs the original.
 */
function buildSegmentText(
  pages: PageWithAnchors[],
  originalText: string,
): string {
  if (pages.length === 0) return "";
  const start = pages[0].page.startOffset;
  const end = pages[pages.length - 1].page.endOffset;
  return originalText.slice(start, end);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MULTI_FORM_THRESHOLD = 0.60;

/**
 * Segment a multi-form PDF text into independent form segments.
 *
 * Pure function. No server-only, no DB, no IO, no randomness.
 * Returns a single segment when confidence is below threshold (fail-safe).
 */
export function segmentPdfText(text: string): SegmentationResult {
  // Handle empty/blank text
  if (text.trim().length === 0) {
    return {
      segments: [
        {
          segmentIndex: 0,
          startPage: 1,
          endPage: 1,
          text,
          anchors: [],
          confidence: 0,
        },
      ],
      multiFormConfidence: 0,
      isMultiForm: false,
      totalPages: text.length === 0 ? 0 : 1,
    };
  }

  // Step 1: Parse pages
  const pages = parsePages(text);
  const totalPages = pages.length;

  // Step 2: Detect anchors per page
  const pagesWithAnchors: PageWithAnchors[] = pages.map((page) => {
    const anchors = detectAnchorsOnPage(page);
    return {
      page,
      anchors,
      hasStrongAnchor: anchors.some(isStrongAnchor),
    };
  });

  // Collect all anchors
  const allAnchors = pagesWithAnchors.flatMap((p) => p.anchors);

  // Step 3: Group into segments
  const groups = groupIntoSegments(pagesWithAnchors);

  // Step 4: Compute confidence
  const multiFormConfidence = computeMultiFormConfidence(
    allAnchors,
    groups.length,
  );

  // Step 5: Apply threshold — fail-safe to single segment
  if (multiFormConfidence < MULTI_FORM_THRESHOLD || groups.length <= 1) {
    return {
      segments: [
        {
          segmentIndex: 0,
          startPage: pages[0].pageNumber,
          endPage: pages[pages.length - 1].pageNumber,
          text,
          anchors: allAnchors,
          confidence: multiFormConfidence,
        },
      ],
      multiFormConfidence,
      isMultiForm: false,
      totalPages,
    };
  }

  // Build final segments
  const segments: PdfSegment[] = groups.map((group, idx) => {
    const groupAnchors = group.pages.flatMap((p) => p.anchors);
    const segmentConfidence =
      groupAnchors.length > 0
        ? groupAnchors.reduce((max, a) => (a.confidence > max ? a.confidence : max), 0)
        : 0;

    return {
      segmentIndex: idx,
      startPage: group.pages[0].page.pageNumber,
      endPage: group.pages[group.pages.length - 1].page.pageNumber,
      text: buildSegmentText(group.pages, text),
      anchors: groupAnchors,
      confidence: segmentConfidence,
    };
  });

  return {
    segments,
    multiFormConfidence,
    isMultiForm: true,
    totalPages,
  };
}
