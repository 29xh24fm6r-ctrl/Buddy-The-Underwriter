import "server-only";

/**
 * Phase 65F — Borrower Portal Request Status
 *
 * GET /api/portal/[token]/request-status
 *
 * Returns borrower-safe campaign + items status for the token's deal.
 * No internal blocker codes, no Omega, no underwriting rationale.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveBorrowerPortalStatus } from "@/core/borrower-orchestration/deriveBorrowerPortalStatus";
import type { BorrowerCampaignStatus, BorrowerItemStatus } from "@/core/borrower-orchestration/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const sb = supabaseAdmin();

  // Validate token
  const { data: link } = await sb
    .from("borrower_portal_links")
    .select("id, deal_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!link) {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 404 });
  }

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ ok: false, error: "token_expired" }, { status: 410 });
  }

  // Find active campaign for this deal linked to this portal link (or any active campaign)
  const { data: campaign } = await sb
    .from("borrower_request_campaigns")
    .select("id, status, action_code, borrower_name, created_at")
    .eq("deal_id", link.deal_id)
    .in("status", ["sent", "in_progress", "completed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({
      ok: true,
      campaign: null,
      items: [],
      progress: null,
    });
  }

  // Fetch items — only expose borrower-safe fields
  const { data: items } = await sb
    .from("borrower_request_items")
    .select("id, title, description, status, required, completed_at")
    .eq("campaign_id", campaign.id)
    .order("created_at", { ascending: true });

  const portalStatus = deriveBorrowerPortalStatus(
    campaign.status as BorrowerCampaignStatus,
    (items ?? []).map((i: any) => ({
      ...i,
      status: i.status as BorrowerItemStatus,
    })),
  );

  return NextResponse.json({
    ok: true,
    campaign: {
      id: campaign.id,
      status: campaign.status,
      borrowerName: campaign.borrower_name,
    },
    items: portalStatus.items,
    progress: {
      totalItems: portalStatus.totalItems,
      completedItems: portalStatus.completedItems,
      pendingItems: portalStatus.pendingItems,
      progressPercent: portalStatus.progressPercent,
      statusLabel: portalStatus.statusLabel,
    },
  });
}
