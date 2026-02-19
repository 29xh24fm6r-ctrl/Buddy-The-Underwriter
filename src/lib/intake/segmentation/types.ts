/**
 * PDF Segmentation v1.2 — Types
 *
 * Pure type definitions. No runtime deps.
 */

export type SegmentAnchorType =
  | "irs_form_header"
  | "sba_form_header"
  | "financial_header"
  | "page_marker";

export type SegmentAnchor = {
  type: SegmentAnchorType;
  pageNumber: number;
  offset: number;
  matchedText: string;
  confidence: number;
};

export type PdfSegment = {
  segmentIndex: number;
  startPage: number;
  endPage: number;
  text: string;
  anchors: SegmentAnchor[];
  confidence: number;
};

export type SegmentationResult = {
  segments: PdfSegment[];
  /** Overall confidence that this PDF contains multiple distinct forms */
  multiFormConfidence: number;
  /** True when we detected >= 2 distinct form boundaries at sufficient confidence */
  isMultiForm: boolean;
  /** Total pages detected in original text */
  totalPages: number;
};

export const SEGMENTATION_VERSION = "v1.2";
