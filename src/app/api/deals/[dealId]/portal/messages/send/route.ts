// src/app/api/deals/[dealId]/portal/messages/send/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// route-class: CLERK (SPEC-SEC-1)

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    // SPEC-SEC-1: enforce Clerk auth + bank-tenant access before sending a
    // message into the borrower conversation.
    await assertDealAccess(dealId);
    const sb = supabaseAdmin();
    const { body, authorName } = await req.json().catch(() => ({}));

    if (!body || typeof body !== "string" || !body.trim()) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .single();

    if (dealErr || !deal)
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const { error } = await sb.from("borrower_messages").insert({
      deal_id: dealId,
      bank_id: deal.bank_id,
      invite_id: null,
      direction: "bank",
      author_name:
        typeof authorName === "string" && authorName.trim()
          ? authorName.trim()
          : "Lending Team",
      body: body.trim(),
    });

    if (error)
      return NextResponse.json({ error: "Failed to send" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { error: err?.message ?? "send_failed" },
      { status: 500 },
    );
  }
}
