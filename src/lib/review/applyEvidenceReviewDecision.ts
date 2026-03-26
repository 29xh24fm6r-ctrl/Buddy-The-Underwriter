import "server-only";

/**
 * Phase 54C — Apply Banker Review Decision
 *
 * Accepts a review decision, updates the review record,
 * feeds outcomes into condition status and borrower guidance.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { recomputeDealReady } from "@/lib/deals/readiness";
import type { ReviewDecisionInput, EvidenceReviewState } from "./evidence-review-types";

export type ReviewDecisionResult = {
  ok: true;
  reviewId: string;
  newState: EvidenceReviewState;
  conditionStatusUpdated: boolean;
} | {
  ok: false;
  error: string;
};

const ACTION_TO_STATE: Record<string, EvidenceReviewState> = {
  accept: "accepted",
  partially_accept: "partially_accepted",
  reject: "rejected",
  request_clarification: "clarification_requested",
  waive: "waived",
};

export async function applyEvidenceReviewDecision(
  input: ReviewDecisionInput,
): Promise<ReviewDecisionResult> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const newState = ACTION_TO_STATE[input.action];

  if (!newState) {
    return { ok: false, error: `Unknown action: ${input.action}` };
  }

  // Validate required fields per action
  if ((input.action === "reject" || input.action === "request_clarification") && !input.explanationBorrowerSafe) {
    return { ok: false, error: `${input.action} requires explanationBorrowerSafe` };
  }
  if (input.action === "waive" && !input.explanationInternal) {
    return { ok: false, error: "waive requires explanationInternal rationale" };
  }

  try {
    // 1. Load the review item to get deal/condition context
    const { data: review, error: loadErr } = await sb
      .from("condition_evidence_reviews")
      .select("id, deal_id, bank_id, condition_id, document_id")
      .eq("id", input.reviewId)
      .eq("deal_id", input.dealId)
      .maybeSingle();

    if (loadErr || !review) {
      return { ok: false, error: "Review item not found" };
    }

    // 2. Update review record
    const { error: updateErr } = await sb
      .from("condition_evidence_reviews")
      .update({
        review_state: newState,
        review_reason_category: input.reasonCategory ?? null,
        explanation_borrower_safe: input.explanationBorrowerSafe ?? null,
        explanation_internal: input.explanationInternal ?? null,
        requested_clarification: input.requestedClarification ?? null,
        reviewer_user_id: input.reviewerUserId,
        reviewer_membership_id: input.reviewerMembershipId ?? null,
        reviewed_at: now,
        resolution_applied_at: now,
        updated_at: now,
      })
      .eq("id", input.reviewId);

    if (updateErr) {
      throw new Error(updateErr.message);
    }

    // 3. Update condition status based on action
    let conditionStatusUpdated = false;
    const conditionUpdate = mapActionToConditionStatus(input.action);
    if (conditionUpdate) {
      // Try deal_conditions first
      const { error: condErr } = await sb
        .from("deal_conditions")
        .update({ status: conditionUpdate, updated_at: now })
        .eq("id", review.condition_id)
        .eq("deal_id", review.deal_id);

      if (!condErr) conditionStatusUpdated = true;

      // Also update conditions_to_close if applicable
      if (conditionUpdate === "satisfied") {
        await sb
          .from("conditions_to_close")
          .update({ satisfied: true, satisfied_at: now, satisfied_by: `review:${input.reviewerUserId}` })
          .eq("id", review.condition_id)
          .eq("application_id", review.deal_id)
          .then(() => {});
      }
    }

    // 4. Audit event
    await logLedgerEvent({
      dealId: review.deal_id,
      bankId: review.bank_id,
      eventKey: `evidence_review.${input.action}`,
      uiState: "done",
      uiMessage: `Evidence review: ${input.action}`,
      meta: {
        review_id: input.reviewId,
        condition_id: review.condition_id,
        document_id: review.document_id,
        action: input.action,
        reason_category: input.reasonCategory,
        reviewer_user_id: input.reviewerUserId,
        new_state: newState,
      },
    }).catch(() => {});

    // 5. Recompute readiness (non-blocking)
    recomputeDealReady(review.deal_id).catch(() => {});

    return {
      ok: true,
      reviewId: input.reviewId,
      newState,
      conditionStatusUpdated,
    };
  } catch (err) {
    console.error("[applyEvidenceReviewDecision] Failed", {
      reviewId: input.reviewId,
      action: input.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function mapActionToConditionStatus(action: string): string | null {
  switch (action) {
    case "accept": return "satisfied";
    case "reject": return "rejected";
    case "waive": return "waived";
    case "partially_accept": return "open"; // still needs more
    case "request_clarification": return "open"; // still needs action
    default: return null;
  }
}
