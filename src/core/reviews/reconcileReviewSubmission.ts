import "server-only";

/**
 * Phase 65J — Reconcile Review Submission
 *
 * Borrower evidence → requirement submitted. Banker must complete.
 * Safe for repeated calls.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ReviewCaseType } from "./types";

export type ReconcileReviewInput = {
  dealId: string;
  caseType: ReviewCaseType;
  caseId: string;
};

export type ReconcileReviewResult = {
  ok: boolean;
  updatedCount: number;
};

export async function reconcileReviewSubmission(
  input: ReconcileReviewInput,
): Promise<ReconcileReviewResult> {
  const sb = supabaseAdmin();

  // Get the borrower campaign for this case
  const caseTable = input.caseType === "annual_review"
    ? "deal_annual_review_cases"
    : "deal_renewal_cases";

  const { data: reviewCase } = await sb
    .from(caseTable)
    .select("borrower_campaign_id")
    .eq("id", input.caseId)
    .maybeSingle();

  if (!reviewCase?.borrower_campaign_id) {
    return { ok: true, updatedCount: 0 };
  }

  // Get completed campaign items
  const { data: completedItems } = await sb
    .from("borrower_request_items")
    .select("item_code")
    .eq("campaign_id", reviewCase.borrower_campaign_id)
    .in("status", ["completed", "submitted", "uploaded"]);

  if (!completedItems || completedItems.length === 0) {
    return { ok: true, updatedCount: 0 };
  }

  const completedCodes = completedItems.map((i) => i.item_code);
  let updated = 0;

  // Move matching requirements: requested → submitted
  for (const code of completedCodes) {
    const { count } = await sb
      .from("deal_review_case_requirements")
      .update({ status: "submitted" })
      .eq("case_id", input.caseId)
      .eq("case_type", input.caseType)
      .eq("requirement_code", code)
      .eq("status", "requested");

    updated += count ?? 0;
  }

  if (updated > 0) {
    await sb.from("deal_timeline_events").insert({
      deal_id: input.dealId,
      kind: "review_requirement.submitted",
      title: `${updated} review item${updated > 1 ? "s" : ""} submitted`,
      visible_to_borrower: true,
      meta: { case_type: input.caseType, case_id: input.caseId },
    });
  }

  return { ok: true, updatedCount: updated };
}
