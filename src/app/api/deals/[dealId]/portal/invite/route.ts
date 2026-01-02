// src/app/api/deals/[dealId]/portal/invite/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { newPortalToken, sha256Base64url } from "@/lib/portal/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creates an expiring borrower portal invite for a deal.
 * Returns a portal URL with a one-time token (plaintext token is NOT stored).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email : null;
  const name = typeof body?.name === "string" ? body.name : null;

  const sb = supabaseAdmin();

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .single();

  if (dealErr || !deal)
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const token = newPortalToken();
  const tokenHash = sha256Base64url(token);
  const expiresAt = new Date(
    Date.now() + 1000 * 60 * 60 * 24 * 7,
  ).toISOString(); // 7 days

  const { data: invite, error } = await sb
    .from("borrower_invites")
    .insert({
      deal_id: dealId,
      bank_id: deal.bank_id,
      created_by: null, // optional: wire auth.uid later from your session
      email,
      name,
      token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .select("id, expires_at")
    .single();

  if (error || !invite)
    return NextResponse.json(
      { error: "Failed to create invite" },
      { status: 500 },
    );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const portalUrl = `${baseUrl}/portal/${token}`;

  return NextResponse.json({
    inviteId: invite.id,
    expiresAt: invite.expires_at,
    portalUrl,
  });
}
