import "server-only";

/**
 * Phase 65F — Borrower Progress Reconciliation
 *
 * Consumes borrower events (upload, submit, confirm) and reconciles
 * campaign item state. When all required items complete, closes the campaign.
 *
 * Safe to run repeatedly — idempotent state transitions.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BorrowerItemStatus } from "./types";

export type ReconcileResult = {
  ok: boolean;
  campaignId: string;
  itemsUpdated: number;
  campaignCompleted: boolean;
  error?: string;
};

/**
 * Reconcile a single campaign's progress from its items' evidence.
 */
export async function reconcileBorrowerProgress(
  campaignId: string,
): Promise<ReconcileResult> {
  const sb = supabaseAdmin();

  try {
    // Fetch all items for this campaign
    const { data: items } = await sb
      .from("borrower_request_items")
      .select("id, status, required, evidence_type, campaign_id, deal_id")
      .eq("campaign_id", campaignId);

    if (!items || items.length === 0) {
      return { ok: true, campaignId, itemsUpdated: 0, campaignCompleted: false };
    }

    const dealId = items[0].deal_id;
    let itemsUpdated = 0;

    // Check each incomplete item against evidence in the deal
    for (const item of items) {
      if (isTerminalStatus(item.status as BorrowerItemStatus)) continue;

      const newStatus = await resolveItemStatus(sb, item, dealId);
      if (newStatus && newStatus !== item.status) {
        const isComplete = isTerminalStatus(newStatus);
        await sb
          .from("borrower_request_items")
          .update({
            status: newStatus,
            completed_at: isComplete ? new Date().toISOString() : null,
          })
          .eq("id", item.id);

        await sb.from("borrower_request_events").insert({
          campaign_id: campaignId,
          item_id: item.id,
          deal_id: dealId,
          event_key: `borrower_item.${newStatus}`,
          payload: { previous_status: item.status, new_status: newStatus },
        });

        itemsUpdated++;
      }
    }

    // Check if all required items are now complete
    const { data: remaining } = await sb
      .from("borrower_request_items")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("required", true)
      .not("status", "in", '("completed","waived")');

    const allDone = (remaining?.length ?? 0) === 0;

    if (allDone) {
      // Close campaign
      await sb
        .from("borrower_request_campaigns")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", campaignId)
        .in("status", ["draft", "queued", "sent", "in_progress"]);

      // Deactivate reminders
      await sb
        .from("borrower_reminder_schedule")
        .update({ is_active: false })
        .eq("campaign_id", campaignId);

      await sb.from("borrower_request_events").insert({
        campaign_id: campaignId,
        deal_id: dealId,
        event_key: "borrower_campaign.completed",
        payload: { items_updated: itemsUpdated },
      });
    } else if (itemsUpdated > 0) {
      // Mark as in_progress if we saw activity
      await sb
        .from("borrower_request_campaigns")
        .update({ status: "in_progress" })
        .eq("id", campaignId)
        .in("status", ["sent", "queued"]);
    }

    return { ok: true, campaignId, itemsUpdated, campaignCompleted: allDone };
  } catch (err) {
    return {
      ok: false,
      campaignId,
      itemsUpdated: 0,
      campaignCompleted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Reconcile all active campaigns for a deal.
 */
export async function reconcileAllCampaignsForDeal(
  dealId: string,
): Promise<ReconcileResult[]> {
  const sb = supabaseAdmin();

  const { data: campaigns } = await sb
    .from("borrower_request_campaigns")
    .select("id")
    .eq("deal_id", dealId)
    .in("status", ["sent", "in_progress"]);

  if (!campaigns || campaigns.length === 0) return [];

  const results: ReconcileResult[] = [];
  for (const c of campaigns) {
    results.push(await reconcileBorrowerProgress(c.id));
  }
  return results;
}

function isTerminalStatus(status: BorrowerItemStatus): boolean {
  return status === "completed" || status === "waived";
}

/**
 * Resolve what status an item should be in based on deal evidence.
 */
async function resolveItemStatus(
  sb: ReturnType<typeof supabaseAdmin>,
  item: { evidence_type: string; deal_id: string; status: string },
  dealId: string,
): Promise<BorrowerItemStatus | null> {
  const currentStatus = item.status as BorrowerItemStatus;

  if (item.evidence_type === "document_upload" || item.evidence_type === "document_submit") {
    // Check for any recent uploads on this deal
    const { data: uploads } = await sb
      .from("deal_uploads" as any)
      .select("id, status")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (!uploads || uploads.length === 0) return null;

    const hasConfirmed = uploads.some((u: any) => u.status === "confirmed");
    const hasUploaded = uploads.length > 0;

    if (hasConfirmed && item.evidence_type === "document_submit") {
      return "completed";
    }
    if (hasConfirmed) {
      return "submitted";
    }
    if (hasUploaded && statusRank(currentStatus) < statusRank("uploaded")) {
      return "uploaded";
    }
  }

  if (item.evidence_type === "field_confirmation") {
    // Check if fields have been confirmed for this deal
    const { count } = await sb
      .from("doc_field_extractions" as any)
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("confirmed", true);

    if ((count ?? 0) > 0 && statusRank(currentStatus) < statusRank("confirmed")) {
      return "confirmed";
    }
  }

  if (item.evidence_type === "form_completion") {
    // Check deal builder / borrower info completeness
    const { data: deal } = await sb
      .from("deals")
      .select("borrower_name, borrower_email")
      .eq("id", dealId)
      .single();

    if (deal?.borrower_name && deal?.borrower_email) {
      return "completed";
    }
  }

  return null;
}

const STATUS_RANK: Record<BorrowerItemStatus, number> = {
  pending: 0,
  sent: 1,
  viewed: 2,
  uploaded: 3,
  submitted: 4,
  confirmed: 5,
  completed: 6,
  waived: 6,
};

function statusRank(status: BorrowerItemStatus): number {
  return STATUS_RANK[status] ?? 0;
}
