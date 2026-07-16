// src/app/api/deals/[dealId]/chat/route.ts
import { NextResponse } from "next/server";
import { listDealMessages, sendDealMessage } from "@/lib/deals/chat";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";
import { requireValidInvite } from "@/lib/portal/auth";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";
// route-class: CLERK+PORTAL (SPEC-SEC-1). Serves both the banker cockpit
// (Clerk session + bank-tenant match via assertDealAccess) and the borrower
// portal (invite-token bearer auth, same scheme as
// /api/portal/deals/[dealId]/chat). Previously this route trusted a
// client-supplied `x-user-id` header with no verification and, absent that
// header, explicitly "trusted the dealId filter" for anonymous callers --
// full unauthenticated read/write access to any deal's chat by UUID.

type Caller = { role: "banker"; userId: string } | { role: "borrower" };

async function resolveCaller(req: Request, dealId: string): Promise<Caller> {
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const invite = await requireValidInvite(token);
    if (invite.deal_id !== dealId) throw new Error("Deal ID mismatch");
    return { role: "borrower" };
  }

  const access = await assertDealAccess(dealId);
  return { role: "banker", userId: access.userId };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;

  try {
    await resolveCaller(req, dealId);
  } catch (e: any) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const messages = await listDealMessages(dealId, 200);
    return NextResponse.json({ ok: true, messages });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;

  let caller: Caller;
  try {
    caller = await resolveCaller(req, dealId);
  } catch (e: any) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      body: string;
      senderDisplay?: string | null;
    };

    const msg = await sendDealMessage(
      caller.role === "banker"
        ? {
            dealId,
            senderRole: "banker",
            senderUserId: caller.userId,
            senderDisplay: body.senderDisplay ?? "Bank",
            body: body.body,
          }
        : {
            dealId,
            senderRole: "borrower",
            senderUserId: null,
            senderDisplay: body.senderDisplay ?? "Borrower",
            body: body.body,
          },
    );

    return NextResponse.json({ ok: true, message: msg });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
