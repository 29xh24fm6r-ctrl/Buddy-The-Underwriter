/**
 * POST /api/deals/[dealId]/artifacts/backfill
 *
 * Backfill artifact processing for all existing documents in a deal.
 * This queues all documents that haven't been processed yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { backfillDealArtifacts } from "@/lib/artifacts/queueArtifact";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();

    // Verify deal exists and belongs to bank
    const sb = supabaseAdmin();
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
    }

    if (String(deal.bank_id) !== String(bankId)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    // Log the backfill start
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "artifacts.backfill.start",
      uiState: "working",
      uiMessage: "Starting artifact backfill",
      meta: { triggered_by: userId },
    });

    // Run the backfill
    const stats = await backfillDealArtifacts(dealId, bankId);

    // Log the backfill completion
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "artifacts.backfill.complete",
      uiState: "done",
      uiMessage: `Artifact backfill complete: ${stats.queued} queued, ${stats.skipped} skipped`,
      meta: { ...stats, triggered_by: userId },
    });

    return NextResponse.json({
      ok: true,
      ...stats,
    });
  } catch (error: any) {
    console.error("[artifacts/backfill] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
