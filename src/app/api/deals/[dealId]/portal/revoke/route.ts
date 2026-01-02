// src/app/api/deals/[dealId]/portal/revoke/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Revokes all active invites for a deal.
 * (If you want revoke-by-inviteId later, add it as a parameter.)
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const { error } = await sb
    .from("borrower_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("deal_id", dealId)
    .is("revoked_at", null);

  if (error)
    return NextResponse.json({ error: "Failed to revoke" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
