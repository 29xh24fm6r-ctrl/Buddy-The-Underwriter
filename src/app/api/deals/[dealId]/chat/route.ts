// src/app/api/deals/[dealId]/chat/route.ts
import { NextResponse } from "next/server";
import { listDealMessages, sendDealMessage } from "@/lib/deals/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bankerUserIdFromHeader(req: Request) {
  return req.headers.get("x-user-id");
}

export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;

    // For now, allow access if either banker header present OR borrower (trust dealId filtering)
    // In production, you'd validate borrower has access to this dealId via invite
    const bankerUserId = bankerUserIdFromHeader(req);
    if (!bankerUserId) {
      // Borrower access - could validate via invite token in header/query if needed
      // For now, trust the dealId filter
    }

    const messages = await listDealMessages(dealId, 200);
    return NextResponse.json({ ok: true, messages });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    const body = (await req.json()) as { body: string; senderDisplay?: string | null };

    const bankerUserId = bankerUserIdFromHeader(req);

    if (bankerUserId) {
      const msg = await sendDealMessage({
        dealId,
        senderRole: "banker",
        senderUserId: bankerUserId,
        senderDisplay: body.senderDisplay ?? "Bank",
        body: body.body,
      });
      return NextResponse.json({ ok: true, message: msg });
    }

    // Borrower sending message
    const msg = await sendDealMessage({
      dealId,
      senderRole: "borrower",
      senderUserId: null,
      senderDisplay: body.senderDisplay ?? "Borrower",
      body: body.body,
    });

    return NextResponse.json({ ok: true, message: msg });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
