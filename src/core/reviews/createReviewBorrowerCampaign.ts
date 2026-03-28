import "server-only";

/**
 * Phase 65J — Create Review Borrower Campaign
 *
 * Reuses 65F borrower campaign infrastructure.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildReviewBorrowerPlan } from "./buildReviewBorrowerPlan";
import type { ReviewCaseType, ReviewRequirement } from "./types";

export type CreateReviewCampaignInput = {
  dealId: string;
  bankId: string;
  caseType: ReviewCaseType;
  caseId: string;
  requirements: ReviewRequirement[];
  createdBy: string;
};

export type CreateReviewCampaignResult = {
  ok: boolean;
  campaignId: string | null;
  itemCount: number;
  error?: string;
};

export async function createReviewBorrowerCampaign(
  input: CreateReviewCampaignInput,
): Promise<CreateReviewCampaignResult> {
  const sb = supabaseAdmin();
  const plan = buildReviewBorrowerPlan(input.caseType, input.requirements);

  if (plan.items.length === 0) {
    return { ok: true, campaignId: null, itemCount: 0 };
  }

  // Check existing open campaign for this case
  const actionCode = `review_${input.caseType}_${input.caseId.slice(0, 8)}`;

  const { data: existing } = await sb
    .from("borrower_request_campaigns")
    .select("id")
    .eq("deal_id", input.dealId)
    .eq("action_code", actionCode)
    .in("status", ["draft", "queued", "sent", "in_progress"])
    .maybeSingle();

  if (existing) {
    return { ok: true, campaignId: existing.id, itemCount: plan.items.length };
  }

  // Create campaign
  const { data: campaign, error: campErr } = await sb
    .from("borrower_request_campaigns")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      action_code: actionCode,
      status: "draft",
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (campErr || !campaign) {
    return { ok: false, campaignId: null, itemCount: 0, error: campErr?.message };
  }

  // Insert items
  const itemRows = plan.items.map((item) => ({
    campaign_id: campaign.id,
    deal_id: input.dealId,
    item_code: item.itemCode,
    title: item.title,
    description: item.description,
    required: item.required,
    evidence_type: item.evidenceType,
    status: "pending",
  }));

  await sb.from("borrower_request_items").insert(itemRows);

  // Update requirements to requested
  for (const item of plan.items) {
    await sb
      .from("deal_review_case_requirements")
      .update({ status: "requested" })
      .eq("case_id", input.caseId)
      .eq("requirement_code", item.itemCode)
      .eq("status", "pending");
  }

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "review_borrower_campaign.created",
    title: plan.campaignTitle,
    detail: `${plan.items.length} items requested from borrower.`,
    visible_to_borrower: true,
    meta: { case_type: input.caseType, campaign_id: campaign.id },
  });

  return { ok: true, campaignId: campaign.id, itemCount: plan.items.length };
}
