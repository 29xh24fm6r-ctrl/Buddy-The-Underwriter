import "server-only";

/**
 * Phase 65I — Seed Annual Review
 *
 * Seeds annual review when due date enters 90-day lookahead window.
 * Idempotent per deal + review_year.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

const ANNUAL_REVIEW_LOOKAHEAD_DAYS = 90;

export type SeedAnnualReviewInput = {
  dealId: string;
  bankId: string;
  nextReviewDueAt: string | null;
};

export type SeedAnnualReviewResult = {
  ok: boolean;
  reviewId: string | null;
  created: boolean;
};

export async function seedAnnualReview(
  input: SeedAnnualReviewInput,
): Promise<SeedAnnualReviewResult> {
  if (!input.nextReviewDueAt) {
    return { ok: true, reviewId: null, created: false };
  }

  const dueDate = new Date(input.nextReviewDueAt);
  const now = new Date();
  const daysUntilDue = Math.floor(
    (dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  );

  // Only seed within lookahead window
  if (daysUntilDue > ANNUAL_REVIEW_LOOKAHEAD_DAYS) {
    return { ok: true, reviewId: null, created: false };
  }

  const reviewYear = dueDate.getFullYear();
  const sb = supabaseAdmin();

  // Check existing
  const { data: existing } = await sb
    .from("deal_annual_reviews")
    .select("id")
    .eq("deal_id", input.dealId)
    .eq("review_year", reviewYear)
    .maybeSingle();

  if (existing) {
    return { ok: true, reviewId: existing.id, created: false };
  }

  const { data: review, error } = await sb
    .from("deal_annual_reviews")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      review_year: reviewYear,
      status: "seeded",
      due_at: dueDate.toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    // Unique constraint race
    if (error.code === "23505") {
      const { data: raced } = await sb
        .from("deal_annual_reviews")
        .select("id")
        .eq("deal_id", input.dealId)
        .eq("review_year", reviewYear)
        .single();
      return { ok: true, reviewId: raced?.id ?? null, created: false };
    }
    return { ok: false, reviewId: null, created: false };
  }

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "annual_review.seeded",
    title: `Annual review seeded for ${reviewYear}`,
    detail: `Due: ${dueDate.toISOString().slice(0, 10)}`,
    visible_to_borrower: false,
  });

  return { ok: true, reviewId: review.id, created: true };
}
