import "server-only";

/**
 * SPEC S2 D-5 / SPEC S3 D-2 — GET /api/deals/[dealId]/sba/forms/1919/build
 * Uses the signature-aware wrapper so `result.signature` reflects a real
 * signed_documents row when one exists, not just the pure default.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { buildForm1919WithSignature } from "@/lib/sba/forms/form1919/buildWithSignature";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId } = await assertDealAccess(rawDealId);

    const sb = supabaseAdmin();
    const result = await buildForm1919WithSignature(dealId, sb);

    return NextResponse.json({ ok: true, dealId, ...result });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/sba/forms/1919/build]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
