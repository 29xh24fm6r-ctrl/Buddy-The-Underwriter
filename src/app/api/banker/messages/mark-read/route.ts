// src/app/api/banker/messages/mark-read/route.ts
import { NextResponse } from "next/server";
import { bankerMarkDealRead } from "@/lib/deals/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function POST(req: Request) {
  try {
    const bankerUserId = requireUserId(req);
    const body = (await req.json()) as { dealId: string };
    if (!body?.dealId) throw new Error("Missing dealId.");

    await bankerMarkDealRead({ dealId: body.dealId, bankerUserId });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
