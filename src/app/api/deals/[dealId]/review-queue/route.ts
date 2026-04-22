import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveReviewQueueInsights } from "@/lib/review/deriveReviewQueueInsights";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/review-queue
 *
 * Banker-facing evidence review queue with insights.
 * Auth: Clerk session + deal cockpit access.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const sb = supabaseAdmin();

  const { data: reviews, error } = await sb
    .from("condition_evidence_reviews")
    .select("id, deal_id, bank_id, condition_id, document_id, review_state, review_reason_category, source_of_flag, classifier_confidence, explanation_borrower_safe, requested_clarification, reviewer_user_id, created_at, updated_at, reviewed_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: "Failed to load review queue" }, { status: 500 });
  }

  // Enrich with condition titles
  const conditionIds = [...new Set((reviews ?? []).map((r: any) => r.condition_id))];
  let conditionTitles = new Map<string, string>();
  if (conditionIds.length > 0) {
    const { data: conditions } = await sb
      .from("deal_conditions")
      .select("id, title")
      .in("id", conditionIds);
    for (const c of conditions ?? []) {
      conditionTitles.set(c.id, c.title);
    }
  }

  const items = (reviews ?? []).map((r: any) => ({
    ...r,
    conditionTitle: conditionTitles.get(r.condition_id) ?? "Condition",
  }));

  // Insights
  const hasActionableConditions = items.some((i: any) =>
    i.review_state === "rejected" || i.review_state === "clarification_requested",
  );
  const insights = deriveReviewQueueInsights(
    items.map((i: any) => ({
      id: i.id,
      conditionId: i.condition_id,
      conditionTitle: i.conditionTitle,
      reviewState: i.review_state,
      createdAt: i.created_at,
      reviewedAt: i.reviewed_at,
      sourceOfFlag: i.source_of_flag,
    })),
    hasActionableConditions,
  );

  return NextResponse.json({ ok: true, items, insights });
}
