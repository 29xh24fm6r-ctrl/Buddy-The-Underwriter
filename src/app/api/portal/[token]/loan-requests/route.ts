import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createLoanRequest } from "@/lib/loanRequests/actions";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve deal from portal token.
 * Supports both borrower_portal_links (plain token) and borrower_invites (hash).
 */
async function resolveDealFromToken(
  token: string,
): Promise<{ dealId: string } | null> {
  try {
    const resolved = await resolveBorrowerToken(token);
    return { dealId: resolved.deal_id };
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
