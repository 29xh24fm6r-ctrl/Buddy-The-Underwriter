import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  getLoanRequest,
  updateLoanRequest,
  deleteLoanRequest,
} from "@/lib/loanRequests/actions";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; requestId: string }> },
) {
  try {
    const { dealId, requestId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "deal_not_found" ? 404 : 403;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    const loanRequest = await getLoanRequest(requestId);
    if (!loanRequest || loanRequest.deal_id !== dealId) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, loanRequest });
  } catch (e: any) {
    console.error("[loan-requests/[requestId] GET]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; requestId: string }> },
) {
  try {
    const { dealId, requestId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "deal_not_found" ? 404 : 403;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    // Verify request belongs to deal
    const existing = await getLoanRequest(requestId);
    if (!existing || existing.deal_id !== dealId) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const { userId } = await clerkAuth();
    const result = await updateLoanRequest(requestId, body, userId);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, loanRequest: result.loanRequest });
  } catch (e: any) {
    console.error("[loan-requests/[requestId] PATCH]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; requestId: string }> },
) {
  try {
    const { dealId, requestId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "deal_not_found" ? 404 : 403;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    // Verify request belongs to deal
    const existing = await getLoanRequest(requestId);
    if (!existing || existing.deal_id !== dealId) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 },
      );
    }

    const { userId } = await clerkAuth();
    const result = await deleteLoanRequest(requestId, userId);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[loan-requests/[requestId] DELETE]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
