import "server-only";

/**
 * Phase 65J — Create Annual Review Case
 *
 * One case per seeded annual review. Idempotent.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type CreateAnnualReviewCaseInput = {
  dealId: string;
  bankId: string;
  annualReviewId: string;
  reviewYear: number;
  dueAt: string;
};

export type CreateCaseResult = {
  ok: boolean;
  caseId: string | null;
  created: boolean;
  error?: string;
};

export async function createAnnualReviewCase(
  input: CreateAnnualReviewCaseInput,
): Promise<CreateCaseResult> {
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("deal_annual_review_cases")
    .select("id")
    .eq("annual_review_id", input.annualReviewId)
    .maybeSingle();

  if (existing) {
    return { ok: true, caseId: existing.id, created: false };
  }

  const { data: row, error } = await sb
    .from("deal_annual_review_cases")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      annual_review_id: input.annualReviewId,
      review_year: input.reviewYear,
      status: "seeded",
      readiness_state: "not_started",
      due_at: input.dueAt,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await sb
        .from("deal_annual_review_cases")
        .select("id")
        .eq("annual_review_id", input.annualReviewId)
        .single();
      return { ok: true, caseId: raced?.id ?? null, created: false };
    }
    return { ok: false, caseId: null, created: false, error: error.message };
  }

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "annual_review_case.created",
    title: `Annual review case created for ${input.reviewYear}`,
    visible_to_borrower: false,
  });

  return { ok: true, caseId: row.id, created: true };
}
