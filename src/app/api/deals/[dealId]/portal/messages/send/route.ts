// src/app/api/deals/[dealId]/portal/messages/send/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
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

  if (dealErr || !deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const { error } = await sb.from("borrower_messages").insert({
    deal_id: dealId,
    bank_id: deal.bank_id,
    invite_id: null,
    direction: "bank",
    author_name: typeof authorName === "string" && authorName.trim() ? authorName.trim() : "Lending Team",
    body: body.trim(),
  });

  if (error) return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
