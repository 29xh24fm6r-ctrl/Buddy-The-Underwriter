import "server-only";

/**
 * Phase 54C — Auto-Queue Ambiguous Evidence for Human Review
 *
 * Called by the classification/recompute pipeline when evidence
 * is not safe to auto-resolve. Creates a review queue item.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { ReviewReasonCategory, ReviewSourceOfFlag } from "./evidence-review-types";

export type QueueReviewInput = {
  dealId: string;
  bankId: string;
  conditionId: string;
  documentId: string;
  linkId?: string | null;
  reasonCategory: ReviewReasonCategory;
  sourceOfFlag: ReviewSourceOfFlag;
  classifierConfidence?: number | null;
  ambiguityFlags?: Record<string, unknown> | null;
  explanationInternal?: string | null;
  explanationBorrowerSafe?: string | null;
};

export type QueueReviewResult = {
  ok: true;
  reviewId: string;
  reviewState: "queued_for_review";
} | {
  ok: false;
  error: string;
};

export async function queueEvidenceReview(input: QueueReviewInput): Promise<QueueReviewResult> {
  const sb = supabaseAdmin();

  try {
    const { data: review, error } = await sb
      .from("condition_evidence_reviews")
      .insert({
        deal_id: input.dealId,
        bank_id: input.bankId,
        condition_id: input.conditionId,
        document_id: input.documentId,
        condition_document_link_id: input.linkId ?? null,
        review_state: "queued_for_review",
        review_reason_category: input.reasonCategory,
        source_of_flag: input.sourceOfFlag,
        classifier_confidence: input.classifierConfidence ?? null,
        ambiguity_flags: input.ambiguityFlags ?? null,
        explanation_internal: input.explanationInternal ?? null,
        explanation_borrower_safe: input.explanationBorrowerSafe ?? null,
      })
      .select("id")
      .single();

    if (error || !review) {
      throw new Error(error?.message ?? "Insert failed");
    }

    await logLedgerEvent({
      dealId: input.dealId,
      bankId: input.bankId,
      eventKey: "evidence_review.queued",
      uiState: "waiting",
      uiMessage: "Evidence queued for banker review",
      meta: {
        review_id: review.id,
        condition_id: input.conditionId,
        document_id: input.documentId,
        reason_category: input.reasonCategory,
        source_of_flag: input.sourceOfFlag,
        classifier_confidence: input.classifierConfidence,
      },
    }).catch(() => {});

    return { ok: true, reviewId: review.id, reviewState: "queued_for_review" };
  } catch (err) {
    console.error("[queueEvidenceReview] Failed", {
      dealId: input.dealId,
      conditionId: input.conditionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
