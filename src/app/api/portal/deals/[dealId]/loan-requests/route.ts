// src/app/api/portal/deals/[dealId]/loan-requests/route.ts
import { NextResponse } from "next/server";
import { requireValidInvite } from "@/lib/portal/auth";
import { listLoanRequests, upsertLoanRequest } from "@/lib/deals/loanRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw new Error("Missing authorization token");
    
    const invite = await requireValidInvite(token);
    const { dealId } = await ctx.params;

    if (invite.deal_id !== dealId) {
      throw new Error("Deal ID mismatch");
    }

    const rows = await listLoanRequests(dealId);
    return NextResponse.json({ ok: true, loanRequests: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw new Error("Missing authorization token");
    
    const invite = await requireValidInvite(token);
    const { dealId } = await ctx.params;

    if (invite.deal_id !== dealId) {
      throw new Error("Deal ID mismatch");
    }

    const body = await req.json();

    const row = await upsertLoanRequest({
      ...body,
      deal_id: dealId,
    });

    return NextResponse.json({ ok: true, loanRequest: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
