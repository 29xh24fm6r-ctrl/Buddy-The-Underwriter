import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recomputeDealDocumentState } from "@/lib/documentTruth/recomputeDealDocumentState";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/deals/backfill-document-state
 * Backfill canonical document ledger for pre-Phase-66 deals.
 * Requires CRON_SECRET auth.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    // Find deals without snapshots
    const { data: deals } = await sb
      .from("deals")
      .select("id")
      .not("id", "in", sb.from("deal_document_snapshots").select("deal_id"))
      .limit(50);

    // Fallback: just get deals and filter
    const { data: allDeals } = await sb
      .from("deals")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(100);

    const { data: existingSnapshots } = await sb
      .from("deal_document_snapshots")
      .select("deal_id");

    const existingSet = new Set(
      (existingSnapshots ?? []).map((s: { deal_id: string }) => s.deal_id),
    );

    const toBackfill = (allDeals ?? [])
      .filter((d: { id: string }) => !existingSet.has(d.id))
      .slice(0, 50);

    let processed = 0;
    for (const deal of toBackfill) {
      try {
        await recomputeDealDocumentState(deal.id);
        processed++;
      } catch (err) {
        console.error(`[backfill] failed for deal ${deal.id}:`, err);
      }
    }

    return NextResponse.json({ ok: true, processed, total: toBackfill.length });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
