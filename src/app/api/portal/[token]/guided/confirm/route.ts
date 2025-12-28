/**
 * POST /api/portal/[token]/guided/confirm - Borrower confirms evidence item
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeDealEvent } from "@/lib/events/dealEvents";

type Ctx = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const sb = supabaseAdmin();
  const body = await req.json();

  // Resolve token
  const { data: link } = await sb
    .from("borrower_portal_links")
    .select("deal_id, bank_id, expires_at")
    .eq("token", token)
    .single();

  if (!link || new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ ok: false, error: "Invalid or expired token" }, { status: 401 });
  }

  const { itemId, confirmed, correctedValue, comment } = body;

  // Log confirmation to deal_events
  await writeDealEvent({
    dealId: link.deal_id,
    bankId: link.bank_id,
    kind: "borrower_evidence_confirmed",
    actorRole: "borrower",
    title: `Evidence item ${confirmed ? "confirmed" : "corrected"}`,
    detail: comment || "",
    payload: {
      itemId,
      confirmed,
      correctedValue,
    },
  });

  return NextResponse.json({ ok: true });
}
