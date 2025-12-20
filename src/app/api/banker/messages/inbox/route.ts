// src/app/api/banker/messages/inbox/route.ts
import { NextResponse } from "next/server";
import { bankerListMessageThreads } from "@/lib/deals/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function GET(req: Request) {
  try {
    const bankerUserId = requireUserId(req);
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || 50);

    const threads = await bankerListMessageThreads({ bankerUserId, limit });
    return NextResponse.json({ ok: true, threads });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
