// src/app/api/banker/messages/inbox/route.ts
import { NextResponse } from "next/server";
import { bankerListMessageThreads } from "@/lib/deals/chat";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// route-class: CLERK (SPEC-SEC-1). Previously gated only on the presence of
// a client-supplied `x-user-id` header (any value passed) and queried
// deal_messages with no bank/tenant filter at all -- any caller got deal
// names, borrower names, and the latest chat message for every deal on the
// platform, across every bank. Now requires a real Clerk session and scopes
// the thread list to the caller's own bank.

export async function GET(req: Request) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const bankId = await getCurrentBankId();

    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || 50);

    const threads = await bankerListMessageThreads({ bankerUserId: userId, bankId, limit });
    return NextResponse.json({ ok: true, threads });
  } catch (e: any) {
    const status = e?.message === "not_authenticated" ? 401 : 400;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status },
    );
  }
}
