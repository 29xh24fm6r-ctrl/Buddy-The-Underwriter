// src/app/api/banker/messages/mark-read/route.ts
import { NextResponse } from "next/server";
import { bankerMarkDealRead } from "@/lib/deals/chat";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// route-class: CLERK (SPEC-SEC-1). Previously trusted a client-supplied
// `x-user-id` header with no verification and no check that the caller's
// bank actually owns the deal being marked read.

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { dealId: string };
    if (!body?.dealId) throw new Error("Missing dealId.");

    const access = await assertDealAccess(body.dealId);

    await bankerMarkDealRead({ dealId: body.dealId, bankerUserId: access.userId });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
