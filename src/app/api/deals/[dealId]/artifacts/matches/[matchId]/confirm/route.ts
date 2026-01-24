/**
 * POST /api/deals/[dealId]/artifacts/matches/[matchId]/confirm
 *
 * Confirm a proposed checklist match.
 */

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string; matchId: string }>;
};

export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { dealId, matchId } = await ctx.params;
    const bankId = await getCurrentBankId();

    const sb = supabaseAdmin();

    // Verify match exists and belongs to this deal
    const { data: match, error: matchErr } = await sb
      .from("checklist_item_matches")
      .select("id, deal_id, bank_id, checklist_key, artifact_id, status")
      .eq("id", matchId)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (matchErr || !match) {
      return NextResponse.json({ ok: false, error: "Match not found" }, { status: 404 });
    }

    if (String(match.bank_id) !== String(bankId)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    if (match.status !== "proposed") {
      return NextResponse.json({ ok: false, error: "Match already resolved" }, { status: 400 });
    }

    // Update match status
    const { error: updateErr } = await sb
      .from("checklist_item_matches")
      .update({
        status: "confirmed",
        confirmed_by: userId,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", matchId);

    if (updateErr) {
      console.error("[matches/confirm] update error", updateErr);
      return NextResponse.json({ ok: false, error: "Update failed" }, { status: 500 });
    }

    // Log the confirmation
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "match.confirmed",
      uiState: "done",
      uiMessage: `Match confirmed: ${match.checklist_key}`,
      meta: {
        match_id: matchId,
        artifact_id: match.artifact_id,
        checklist_key: match.checklist_key,
        confirmed_by: userId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[matches/confirm] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
