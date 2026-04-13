import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { generateMissingItemsFollowup } from "@/lib/agentWorkflows/followup/generateMissingItemsFollowup";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/missing-items-followup
 *
 * Generates draft borrower requests for missing items.
 * Anchors to canonical state blockers + deal_gap_queue.
 * Requires super_admin (operational action).
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();

    const result = await generateMissingItemsFollowup(dealId, bankId ?? "");

    return NextResponse.json(result);
  } catch (err) {
    console.error("[missing-items-followup] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "internal" },
      { status: 500 },
    );
  }
}
