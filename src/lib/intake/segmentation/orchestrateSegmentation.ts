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
 * When ENABLE_SEGMENTATION_ENGINE=true and storage context is provided:
 *   HIGH-confidence multi-form PDFs are physically split into child artifacts.
 *   Each child is enqueued for canonical CLASSIFY → MATCH independently.
 *   On split failure: fail-open, route original to review as before.
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
import { isSegmentationEngineEnabled } from "@/lib/flags/segmentationEngine";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SegmentationOrchestrationResult =
  | { segmented: false }
  | {
      segmented: true;
      routedToReview: true;
      physically_split?: boolean;
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
  taxYear: number | null;
};

export type StorageContext = {
  storageBucket: string;
  storagePath: string;
  originalFilename: string;
};

export type OrchestrateSegmentationArgs = {
  ocrText: string;
  filename: string;
  mimeType: string | null;
  dealId: string;
  bankId: string;
  documentId: string;
  docAiSignals?: DocAiSignals;
  /** Present only when physical splitting may be attempted */
  storageContext?: StorageContext;
};

// ---------------------------------------------------------------------------
// Confidence threshold (exported for CI guards and orchestration checks)
// ---------------------------------------------------------------------------

export const SEGMENTATION_CONFIDENCE_THRESHOLD = 0.85;
const PER_SEGMENT_CLASSIFICATION_THRESHOLD = 0.70;

/** Minimum STRONG anchors required before physical splitting is allowed */
const MIN_STRONG_ANCHORS_FOR_SPLIT = 2;

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
 *   - OR: physically split (physically_split=true) — original excluded from pipeline
 *
 * All ledger events include version stamps for audit-safe replay.
 */
export async function orchestrateSegmentation(
  args: OrchestrateSegmentationArgs,
): Promise<SegmentationOrchestrationResult> {
  const {
    ocrText,
    filename,
    mimeType,
    dealId,
    bankId,
    documentId,
    docAiSignals,
    storageContext,
  } = args;

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
      taxYear: classification.taxYear ?? null,
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

  // Step 5: Attempt physical split (when flag on + storage context present)
  const strongAnchorCount = segResult.segments.reduce(
    (count, seg) =>
      count +
      (seg.anchors.some((a) => a.confidence >= 0.90) ? 1 : 0),
    0,
  );

  const splitEligible =
    isSegmentationEngineEnabled() &&
    !!storageContext &&
    strongAnchorCount >= MIN_STRONG_ANCHORS_FOR_SPLIT;

  if (splitEligible && storageContext) {
    // Idempotency: check if already split
    const sb = supabaseAdmin();
    const { data: docState } = await (sb as any)
      .from("deal_documents")
      .select("segmented")
      .eq("id", documentId)
      .maybeSingle();

    if (docState?.segmented === true) {
      // Already split — skip
      return { segmented: false };
    }

    try {
      const { splitPdfIntoSegments } = await import("./splitPdfIntoSegments");
      const splitResult = await splitPdfIntoSegments({
        dealId,
        bankId,
        parentDocId: documentId,
        parentOriginalFilename: storageContext.originalFilename,
        storageBucket: storageContext.storageBucket,
        storagePath: storageContext.storagePath,
        ocrText,
        segments: segResult.segments,
        detectionConfidence: segResult.multiFormConfidence,
      });

      if (splitResult.ok) {
        // Mark original as segmented
        await (sb as any)
          .from("deal_documents")
          .update({ segmented: true })
          .eq("id", documentId);

        // Step 5b: Emit detection event (physically split)
        writeEvent({
          dealId,
          kind: "segmentation.detected",
          meta: {
            segmentation_version: SEGMENTATION_VERSION,
            document_id: documentId,
            segment_count: segResult.segments.length,
            multi_form_confidence: segResult.multiFormConfidence,
            total_pages: segResult.totalPages,
            physically_split: true,
            child_count: splitResult.childCount,
          },
        }).catch(() => {});

        return {
          segmented: true,
          routedToReview: true,
          physically_split: true,
          reason: "physically_split",
          segmentCount: splitResult.childCount,
          segmentClassifications,
        };
      }

      // Split failed → fall through to review routing
      console.warn("[orchestrateSegmentation] physical split failed (fail-open)", {
        documentId,
        reason: splitResult.reason,
      });
    } catch (splitErr: any) {
      console.warn("[orchestrateSegmentation] split error (fail-open)", {
        documentId,
        error: splitErr?.message,
      });
    }
  }

  // Step 6: Emit detection event (detection-only / review path)
  const reason = anyBelowThreshold
    ? "segment_below_classification_threshold"
    : "multi_form_requires_manual_split";

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
      reason,
    },
  }).catch(() => {});

  // Step 7: Route to review
  // Multi-form PDFs always route to review because:
  //   1. One document cannot attach to multiple slots simultaneously
  //   2. Each form within the PDF needs separate slot assignment
  //   3. "Segmentation cannot increase authority" — detection helps humans, never auto-attaches
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
