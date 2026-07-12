import "server-only";

/** SPEC S4 G-3 — GET /api/deals/[dealId]/sba/forms/155/build */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildForm155WithSignature } from "@/lib/sba/forms/form155/buildWithSignature";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId } = await requireDealAccess(rawDealId);

    const sb = supabaseAdmin();
    const result = await buildForm155WithSignature(dealId, bankId, sb);

    return NextResponse.json({ ok: true, dealId, ...result });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/sba/forms/155/build]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
