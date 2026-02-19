/**
 * Segmentation Orchestrator — Server Module
 *
 * Coordinates multi-form PDF segmentation with the full intake pipeline.
 * Each segment is classified independently through the SAME full pipeline.
 *
 * Authority invariant (non-negotiable):
 *   Segmentation changes INPUT GRANULARITY only, never matching rules.
 *   Each segment independently passes through the full pipeline:
 *     authority gates, confidence gates, entity ambiguity, multi-year blocks,
 *     year confidence thresholds — all apply per-segment.
 *   No cross-segment inference allowed.
 *
 * Multi-form PDFs route to review because one document cannot be attached
 * to multiple slots simultaneously. Segment classifications are recorded
 * in ledger events for human reviewers.
 *
 * Fail-open: any error → returns { segmented: false } (caller continues normal pipeline).
 */

import "server-only";

import { segmentPdfText } from "./segmentPdfText";
import { SEGMENTATION_VERSION } from "./types";
import type { PdfSegment } from "./types";
import { classifyDocumentSpine } from "@/lib/classification/classifyDocumentSpine";
import type { SpineClassificationResult, DocAiSignals } from "@/lib/classification/types";
import { writeEvent } from "@/lib/ledger/writeEvent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SegmentationOrchestrationResult =
  | { segmented: false }
  | {
      segmented: true;
      routedToReview: true;
      reason: string;
      segmentCount: number;
      segmentClassifications: SegmentClassificationSummary[];
    };

type SegmentClassificationSummary = {
  segmentIndex: number;
  startPage: number;
  endPage: number;
  docType: string | null;
  confidence: number;
  spineTier: string | null;
};

export type OrchestrateSegmentationArgs = {
  ocrText: string;
  filename: string;
  mimeType: string | null;
  dealId: string;
  bankId: string;
  documentId: string;
  docAiSignals?: DocAiSignals;
};

// ---------------------------------------------------------------------------
// Confidence threshold for segmentation to act
// ---------------------------------------------------------------------------

const SEGMENTATION_CONFIDENCE_THRESHOLD = 0.85;
const PER_SEGMENT_CLASSIFICATION_THRESHOLD = 0.70;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to segment a multi-form PDF and classify each segment independently.
 *
 * Returns `{ segmented: false }` when:
 *   - Text is not multi-form
 *   - Confidence is below threshold
 *   - Any error occurs (fail-open)
 *
 * Returns `{ segmented: true, routedToReview: true }` when:
 *   - Multi-form detected at sufficient confidence
 *   - Each segment classified independently
 *   - Document routed to review (one document cannot attach to multiple slots)
 *
 * All ledger events include version stamps for audit-safe replay.
 */
export async function orchestrateSegmentation(
  args: OrchestrateSegmentationArgs,
): Promise<SegmentationOrchestrationResult> {
  const { ocrText, filename, mimeType, dealId, bankId, documentId, docAiSignals } = args;

  // Step 1: Run pure segmentation
  const segResult = segmentPdfText(ocrText);

  // Step 2: Not multi-form → bail
  if (!segResult.isMultiForm || segResult.segments.length <= 1) {
    return { segmented: false };
  }

  // Step 3: Confidence gate
  if (segResult.multiFormConfidence < SEGMENTATION_CONFIDENCE_THRESHOLD) {
    // Emit below-threshold event (fire-and-forget)
    writeEvent({
      dealId,
      kind: "segmentation.below_threshold",
      meta: {
        segmentation_version: SEGMENTATION_VERSION,
        document_id: documentId,
        segment_count: segResult.segments.length,
        multi_form_confidence: segResult.multiFormConfidence,
        threshold: SEGMENTATION_CONFIDENCE_THRESHOLD,
        total_pages: segResult.totalPages,
      },
    }).catch(() => {});

    return { segmented: false };
  }

  // Step 4: Classify each segment independently
  const segmentClassifications: SegmentClassificationSummary[] = [];
  let anyBelowThreshold = false;

  for (const segment of segResult.segments) {
    const classification = await classifySegmentIndependently(
      segment,
      filename,
      mimeType,
      docAiSignals,
    );

    const summary: SegmentClassificationSummary = {
      segmentIndex: segment.segmentIndex,
      startPage: segment.startPage,
      endPage: segment.endPage,
      docType: classification.docType ?? null,
      confidence: classification.confidence,
      spineTier: classification.spineTier ?? null,
    };

    segmentClassifications.push(summary);

    // Emit per-segment event (fire-and-forget)
    writeEvent({
      dealId,
      kind: "segmentation.segment_classified",
      meta: {
        segmentation_version: SEGMENTATION_VERSION,
        document_id: documentId,
        segment_index: segment.segmentIndex,
        start_page: segment.startPage,
        end_page: segment.endPage,
        doc_type: classification.docType,
        confidence: classification.confidence,
        spine_tier: classification.spineTier,
        classification_version: classification.spineVersion,
      },
    }).catch(() => {});

    // Authority check: if any segment confidence is too low, route entire doc to review
    if (classification.confidence < PER_SEGMENT_CLASSIFICATION_THRESHOLD) {
      anyBelowThreshold = true;
    }
  }

  // Step 5: Emit detection event
  writeEvent({
    dealId,
    kind: "segmentation.detected",
    meta: {
      segmentation_version: SEGMENTATION_VERSION,
      document_id: documentId,
      segment_count: segResult.segments.length,
      multi_form_confidence: segResult.multiFormConfidence,
      total_pages: segResult.totalPages,
      segment_summaries: segmentClassifications,
      routed_to_review: true,
      reason: anyBelowThreshold
        ? "segment_below_classification_threshold"
        : "multi_form_requires_manual_split",
    },
  }).catch(() => {});

  // Step 6: Route to review
  // Multi-form PDFs always route to review because:
  //   1. One document cannot attach to multiple slots simultaneously
  //   2. Each form within the PDF needs separate slot assignment
  //   3. "Segmentation cannot increase authority" — detection helps humans, never auto-attaches
  const reason = anyBelowThreshold
    ? "segment_below_classification_threshold"
    : "multi_form_requires_manual_split";

  return {
    segmented: true,
    routedToReview: true,
    reason,
    segmentCount: segResult.segments.length,
    segmentClassifications,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify a single segment through the full classification spine.
 * Each segment independently passes through ALL authority tiers.
 * No cross-segment inference. No authority upgrades.
 */
async function classifySegmentIndependently(
  segment: PdfSegment,
  filename: string,
  mimeType: string | null,
  docAiSignals?: DocAiSignals,
): Promise<SpineClassificationResult> {
  return classifyDocumentSpine(
    segment.text,
    filename,
    mimeType,
    docAiSignals,
  );
}
