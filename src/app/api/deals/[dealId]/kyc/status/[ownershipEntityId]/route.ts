import "server-only";

/** SPEC S3 A-4 — GET /api/deals/[dealId]/kyc/status/[ownershipEntityId] */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; ownershipEntityId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId, ownershipEntityId } = await ctx.params;
    const { dealId } = await requireDealAccess(rawDealId);

    const sb = supabaseAdmin();
    const { data } = await sb
      .from("borrower_identity_verifications")
      .select("*")
      .eq("deal_id", dealId)
      .eq("ownership_entity_id", ownershipEntityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({ ok: true, verification: data ?? null });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/kyc/status/[ownershipEntityId]]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
