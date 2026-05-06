/**
 * POST /api/deals/[dealId]/overrides/[overrideId]/review
 *
 * SPEC-06 — banker marks an override as reviewed (sets requires_review=false).
 * Optional body: { reviewer_note?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { writeDealEvent } from "@/lib/events/dealEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; overrideId: string }> },
) {
  const { dealId, overrideId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const reviewer_note = body?.reviewer_note ? String(body.reviewer_note).trim() : null;

  const { data: existing, error: fetchErr } = await sb
    .from("decision_overrides")
    .select("id, deal_id, requires_review")
    .eq("id", overrideId)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json(
      { ok: false, error: fetchErr.message },
      { status: 500 },
    );
  }
  if (!existing || existing.deal_id !== dealId) {
    return NextResponse.json(
      { ok: false, error: "override_not_found" },
      { status: 404 },
    );
  }

  const { data, error } = await sb
    .from("decision_overrides")
    .update({ requires_review: false })
    .eq("id", overrideId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  try {
    await writeDealEvent({
      dealId,
      bankId,
      kind: "override.reviewed",
      payload: {
        overrideId,
        reviewer_note,
        source: "stage_cockpit",
      },
    });
  } catch {
    // best-effort audit log
  }

  return NextResponse.json({ ok: true, override: data });
}
