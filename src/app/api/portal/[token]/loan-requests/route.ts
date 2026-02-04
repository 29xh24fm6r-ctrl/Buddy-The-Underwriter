import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createLoanRequest } from "@/lib/loanRequests/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve deal from portal token.
 * Supports both borrower_portal_links (plain token) and borrower_invites (hash).
 */
async function resolveDealFromToken(
  token: string,
): Promise<{ dealId: string } | null> {
  const sb = supabaseAdmin();

  // Try borrower_portal_links first (plain token match)
  const { data: link } = await sb
    .from("borrower_portal_links")
    .select("deal_id, expires_at, used_at, single_use")
    .eq("token", token)
    .maybeSingle();

  if (link) {
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      return null;
    }
    return { dealId: link.deal_id };
  }

  // Fall back to borrower_invites (SHA256 hash)
  try {
    const { sha256Base64url } = await import("@/lib/portal/token");
    const tokenHash = sha256Base64url(token);
    const { data: invite } = await sb
      .from("borrower_invites")
      .select("deal_id, expires_at, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!invite) return null;
    if (invite.revoked_at) return null;
    if (invite.expires_at && new Date(invite.expires_at) < new Date())
      return null;

    return { dealId: invite.deal_id };
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await ctx.params;
    const resolved = await resolveDealFromToken(token);

    if (!resolved) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired token" },
        { status: 401 },
      );
    }

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("deal_loan_requests")
      .select("*")
      .eq("deal_id", resolved.dealId)
      .order("request_number", { ascending: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, requests: data ?? [] });
  } catch (e: any) {
    console.error("[portal/loan-requests GET]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await ctx.params;
    const resolved = await resolveDealFromToken(token);

    if (!resolved) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired token" },
        { status: 401 },
      );
    }

    const body = await req.json().catch(() => ({}));

    if (!body?.product_type) {
      return NextResponse.json(
        { ok: false, error: "product_type is required" },
        { status: 400 },
      );
    }

    if (!body?.requested_amount || Number(body.requested_amount) <= 0) {
      return NextResponse.json(
        { ok: false, error: "requested_amount is required" },
        { status: 400 },
      );
    }

    const result = await createLoanRequest(
      resolved.dealId,
      body,
      null,
      "borrower_portal",
      "submitted",
    );

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, loanRequest: result.loanRequest });
  } catch (e: any) {
    console.error("[portal/loan-requests POST]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
