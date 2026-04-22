import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();
    const { data: score, error } = await sb
      .from("deal_underwriting_scores")
      .select("id, deal_id, snapshot_id, score, grade, confidence, drivers_json, created_at")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (!score) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, dealId, score });
  } catch (e: any) {
    rethrowNextErrors(e);

    console.error("[/api/deals/[dealId]/underwriting/score]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
