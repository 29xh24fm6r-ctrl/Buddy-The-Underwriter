import "server-only";

/**
 * Phase 65J — Complete Review/Renewal Case
 *
 * Only succeeds if readiness = ready.
 * Annual review → completed. Renewal → decision_pending or completed.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveReviewReadiness } from "./deriveReviewReadiness";
import type { ReviewCaseType, ReviewRequirementStatus } from "./types";

export type CompleteCaseInput = {
  dealId: string;
  caseType: ReviewCaseType;
  caseId: string;
  completedBy: string;
};

export type CompleteCaseResult = {
  ok: boolean;
  newStatus: string;
  error?: string;
};

export async function completeReviewCase(
  input: CompleteCaseInput,
): Promise<CompleteCaseResult> {
  const sb = supabaseAdmin();

  // Fetch requirements + exceptions to verify readiness
  const [reqs, exceptions] = await Promise.all([
    sb
      .from("deal_review_case_requirements")
      .select("required, status, borrower_visible")
      .eq("case_id", input.caseId)
      .eq("case_type", input.caseType),
    sb
      .from("deal_review_case_exceptions")
      .select("id")
      .eq("case_id", input.caseId)
      .eq("case_type", input.caseType)
      .eq("status", "open"),
  ]);

  const readiness = deriveReviewReadiness({
    requirements: (reqs.data ?? []).map((r) => ({
      required: r.required,
      status: r.status as ReviewRequirementStatus,
      borrowerVisible: r.borrower_visible,
    })),
    openExceptionCount: exceptions.count ?? (exceptions.data?.length ?? 0),
  });

  if (readiness !== "ready") {
    return {
      ok: false,
      newStatus: "",
      error: `Cannot complete: readiness is "${readiness}", must be "ready"`,
    };
  }

  const now = new Date().toISOString();
  const newStatus = input.caseType === "renewal" ? "decision_pending" : "completed";

  const caseTable = input.caseType === "annual_review"
    ? "deal_annual_review_cases"
    : "deal_renewal_cases";

  await sb
    .from(caseTable)
    .update({
      status: newStatus,
      readiness_state: "ready",
      ready_at: now,
      completed_at: newStatus === "completed" ? now : null,
    })
    .eq("id", input.caseId);

  // Update linked seed table
  if (input.caseType === "annual_review") {
    const { data: reviewCase } = await sb
      .from("deal_annual_review_cases")
      .select("annual_review_id")
      .eq("id", input.caseId)
      .single();
    if (reviewCase) {
      await sb
        .from("deal_annual_reviews")
        .update({ status: "completed" })
        .eq("id", reviewCase.annual_review_id);
    }
  } else {
    const { data: renewalCase } = await sb
      .from("deal_renewal_cases")
      .select("renewal_prep_id")
      .eq("id", input.caseId)
      .single();
    if (renewalCase) {
      await sb
        .from("deal_renewal_prep")
        .update({ status: newStatus === "decision_pending" ? "in_progress" : "completed" })
        .eq("id", renewalCase.renewal_prep_id);
    }
  }

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "review_case.completed",
    title: `${input.caseType === "annual_review" ? "Annual review" : "Renewal case"} ${newStatus.replace(/_/g, " ")}`,
    visible_to_borrower: false,
    meta: { case_type: input.caseType, case_id: input.caseId, completed_by: input.completedBy },
  });

  return { ok: true, newStatus };
}
