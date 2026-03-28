import "server-only";

/**
 * Phase 65F — Borrower Campaign Creation
 *
 * Creates a borrower request campaign from a canonical execution.
 * Idempotent: reuses open campaign for the same canonical execution.
 */

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BuddyActionCode } from "@/core/actions/types";
import type { CreateCampaignInput, CreateCampaignResult } from "./types";
import { buildBorrowerRequestPlan } from "./mapCanonicalActionToBorrowerPlan";

export async function createBorrowerCampaign(
  input: CreateCampaignInput,
): Promise<CreateCampaignResult> {
  const sb = supabaseAdmin();

  try {
    // Idempotency: check for existing open campaign for this execution
    const { data: existing } = await sb
      .from("borrower_request_campaigns")
      .select("id, portal_link_id, status")
      .eq("canonical_execution_id", input.canonicalExecutionId)
      .in("status", ["draft", "queued", "sent", "in_progress"])
      .maybeSingle();

    if (existing) {
      const { count } = await sb
        .from("borrower_request_items")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", existing.id);

      return {
        ok: true,
        campaignId: existing.id,
        portalLinkId: existing.portal_link_id,
        itemCount: count ?? 0,
      };
    }

    // Build plan
    const plan = buildBorrowerRequestPlan(input.actionCode as BuddyActionCode, {
      borrowerPhone: input.borrowerPhone,
      borrowerEmail: input.borrowerEmail,
    });

    if (!plan || plan.items.length === 0) {
      return {
        ok: false,
        campaignId: null,
        portalLinkId: null,
        itemCount: 0,
        error: "Action is not borrower-orchestratable or has no items.",
      };
    }

    // Create or reuse portal link
    let portalLinkId: string | null = null;

    if (plan.requiresPortalLink) {
      // Check for existing active link
      const { data: activeLink } = await sb
        .from("borrower_portal_links")
        .select("id, token")
        .eq("deal_id", input.dealId)
        .gt("expires_at", new Date().toISOString())
        .is("used_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeLink) {
        portalLinkId = activeLink.id;
      } else {
        const token = crypto.randomBytes(24).toString("base64url");
        const expiresAt = new Date(
          Date.now() + 7 * 24 * 3600 * 1000,
        ).toISOString();

        const { data: newLink } = await sb
          .from("borrower_portal_links")
          .insert({
            deal_id: input.dealId,
            token,
            label: plan.campaignTitle,
            single_use: false,
            expires_at: expiresAt,
            channel: "campaign",
            bank_id: input.bankId,
          })
          .select("id")
          .single();

        portalLinkId = newLink?.id ?? null;
      }
    }

    // Create campaign
    const { data: campaign } = await sb
      .from("borrower_request_campaigns")
      .insert({
        deal_id: input.dealId,
        bank_id: input.bankId,
        canonical_execution_id: input.canonicalExecutionId,
        action_code: input.actionCode,
        status: "draft",
        borrower_name: input.borrowerName ?? null,
        borrower_phone: input.borrowerPhone ?? null,
        borrower_email: input.borrowerEmail ?? null,
        portal_link_id: portalLinkId,
        created_by: input.createdBy,
      })
      .select("id")
      .single();

    if (!campaign) {
      return {
        ok: false,
        campaignId: null,
        portalLinkId: null,
        itemCount: 0,
        error: "Failed to create campaign row.",
      };
    }

    // Create items
    const itemRows = plan.items.map((item) => ({
      campaign_id: campaign.id,
      deal_id: input.dealId,
      checklist_key: item.checklistKey ?? null,
      blocker_code: item.blockerCode ?? null,
      item_code: item.itemCode,
      title: item.title,
      description: item.description,
      required: item.required,
      evidence_type: item.evidenceType,
      status: "pending" as const,
    }));

    await sb.from("borrower_request_items").insert(itemRows);

    // Record creation event
    await sb.from("borrower_request_events").insert({
      campaign_id: campaign.id,
      deal_id: input.dealId,
      event_key: "borrower_campaign.created",
      payload: {
        action_code: input.actionCode,
        item_count: itemRows.length,
        created_by: input.createdBy,
      },
    });

    return {
      ok: true,
      campaignId: campaign.id,
      portalLinkId,
      itemCount: itemRows.length,
    };
  } catch (err) {
    return {
      ok: false,
      campaignId: null,
      portalLinkId: null,
      itemCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
