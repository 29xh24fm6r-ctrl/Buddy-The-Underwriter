import "server-only";

/**
 * SPEC S7 (ARC-00 Phase 5) — Form 722 (not fillable): GET returns
 * poster-availability + acknowledgment status, POST records the
 * acknowledgment. One file, two HTTP methods, rather than a
 * build/render pair — there's no PDF to fill.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { getForm722Status, acknowledgeForm722 } from "@/lib/sba/forms/form722/service";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId } = await requireDealAccess(rawDealId);
    const status = await getForm722Status(dealId, supabaseAdmin());
    return NextResponse.json({ ok: true, ...status });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/sba/forms/722] GET", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId, userId } = await requireDealAccess(rawDealId);
    const result = await acknowledgeForm722(dealId, bankId, supabaseAdmin(), { acknowledgedByUserId: userId });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/sba/forms/722] POST", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
