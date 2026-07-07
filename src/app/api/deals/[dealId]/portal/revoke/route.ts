// src/app/api/deals/[dealId]/portal/revoke/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// route-class: CLERK (SPEC-SEC-1)

/**
 * Revokes all active invites for a deal.
 * (If you want revoke-by-inviteId later, add it as a parameter.)
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    // SPEC-SEC-1: enforce Clerk auth + bank-tenant access before revoking invites.
    await assertDealAccess(dealId);
    const sb = supabaseAdmin();

    const { error } = await sb
      .from("borrower_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("deal_id", dealId)
      .is("revoked_at", null);

    if (error)
      return NextResponse.json({ error: "Failed to revoke" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { error: err?.message ?? "revoke_failed" },
      { status: 500 },
    );
  }
}
