import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

const ALLOWED_STATUSES = ["not_started", "in_progress", "needs_refresh", "completed"];

/**
 * PATCH /api/deals/[dealId]/underwrite/workspace
 * Update workspace fields: analyst assignment, workstream statuses.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;
    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const sb = supabaseAdmin();

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.assignedAnalystId !== undefined) updateData.assigned_analyst_id = body.assignedAnalystId;
    if (body.spreadStatus && ALLOWED_STATUSES.includes(body.spreadStatus)) updateData.spread_status = body.spreadStatus;
    if (body.memoStatus && ALLOWED_STATUSES.includes(body.memoStatus)) updateData.memo_status = body.memoStatus;
    if (body.riskStatus && ALLOWED_STATUSES.includes(body.riskStatus)) updateData.risk_status = body.riskStatus;

    const { error } = await sb
      .from("underwriting_workspaces")
      .update(updateData)
      .eq("deal_id", dealId);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
