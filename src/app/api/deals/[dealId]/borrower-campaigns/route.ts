import "server-only";

/**
 * Phase 65F — Borrower Campaign Routes
 *
 * GET  — list campaigns for deal
 * POST — create campaign from canonical execution
 */

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createBorrowerCampaign } from "@/core/borrower-orchestration/createBorrowerCampaign";
import { sendBorrowerCampaign } from "@/core/borrower-orchestration/sendBorrowerCampaign";
import { scheduleBorrowerReminders } from "@/core/borrower-orchestration/scheduleBorrowerReminders";
import { BORROWER_ORCHESTRATABLE_ACTIONS } from "@/core/borrower-orchestration/mapCanonicalActionToBorrowerPlan";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/** GET /api/deals/[dealId]/borrower-campaigns — list campaigns */
export async function GET(_req: Request, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: campaigns } = await sb
    .from("borrower_request_campaigns")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  // Fetch item counts per campaign
  const enriched = await Promise.all(
    (campaigns ?? []).map(async (c: any) => {
      const { count: totalItems } = await sb
        .from("borrower_request_items")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id);
      const { count: completedItems } = await sb
        .from("borrower_request_items")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id)
        .in("status", ["completed", "waived"]);
      return { ...c, totalItems: totalItems ?? 0, completedItems: completedItems ?? 0 };
    }),
  );

  return NextResponse.json({ ok: true, campaigns: enriched });
}

/** POST /api/deals/[dealId]/borrower-campaigns — create from canonical execution */
export async function POST(req: Request, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const canonicalExecutionId = body?.canonicalExecutionId as string | undefined;

  if (!canonicalExecutionId) {
    return NextResponse.json({ ok: false, error: "missing_canonical_execution_id" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Validate execution belongs to this deal
  const { data: execution } = await sb
    .from("canonical_action_executions")
    .select("id, action_code, deal_id, bank_id")
    .eq("id", canonicalExecutionId)
    .eq("deal_id", dealId)
    .single();

  if (!execution) {
    return NextResponse.json({ ok: false, error: "execution_not_found" }, { status: 404 });
  }

  // Validate action is borrower-orchestratable
  if (!BORROWER_ORCHESTRATABLE_ACTIONS.has(execution.action_code as any)) {
    return NextResponse.json({
      ok: false,
      error: "action_not_borrower_orchestratable",
      detail: `${execution.action_code} cannot create a borrower campaign.`,
    }, { status: 422 });
  }

  // Get borrower contact info from deal
  const { data: deal } = await sb
    .from("deals")
    .select("borrower_name, borrower_email, borrower_phone")
    .eq("id", dealId)
    .single();

  // Create campaign
  const result = await createBorrowerCampaign({
    dealId,
    bankId: access.bankId,
    canonicalExecutionId,
    actionCode: execution.action_code,
    borrowerName: (deal as any)?.borrower_name ?? null,
    borrowerPhone: (deal as any)?.borrower_phone ?? null,
    borrowerEmail: (deal as any)?.borrower_email ?? null,
    createdBy: access.userId,
  });

  if (!result.ok || !result.campaignId) {
    return NextResponse.json({ ok: false, error: result.error ?? "Failed" }, { status: 500 });
  }

  // Send campaign
  const sendResult = await sendBorrowerCampaign({
    campaignId: result.campaignId,
    dealId,
    bankId: access.bankId,
  });

  // Schedule reminders
  if (sendResult.ok) {
    await scheduleBorrowerReminders({ campaignId: result.campaignId });
  }

  return NextResponse.json({
    ok: true,
    campaignId: result.campaignId,
    portalLinkId: result.portalLinkId,
    itemCount: result.itemCount,
    sent: {
      sms: sendResult.smsSent,
      email: sendResult.emailSent,
    },
    portalUrl: sendResult.portalUrl,
  });
}
