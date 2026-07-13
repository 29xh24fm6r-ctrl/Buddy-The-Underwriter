import "server-only";

/**
 * SPEC S2 B-3 — SBA eligibility route.
 *
 * Builds the deal-data input (dealDataBuilder.ts) and runs it through the
 * S1 rules-based eligibility engine (sba_policy_rules, 22 live SOP 50 10 8
 * rules). Returns both the evaluation report and the raw input so the
 * caller (Story tab readiness panel) can show which fields are still null.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { buildSbaEligibilityInput } from "@/lib/sba/dealDataBuilder";
import { evaluateSBAEligibility } from "@/lib/sba/eligibility";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId } = await assertDealAccess(rawDealId);

    const sb = supabaseAdmin();
    const input = await buildSbaEligibilityInput(dealId, sb);
    const report = await evaluateSBAEligibility({
      dealId,
      program: "7A",
      dealData: input as unknown as Record<string, any>,
    });

    return NextResponse.json({ ok: true, report, input });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/sba/eligibility]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
