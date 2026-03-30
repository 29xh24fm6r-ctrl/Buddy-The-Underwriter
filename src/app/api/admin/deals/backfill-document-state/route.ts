import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recomputeDealDocumentState } from "@/lib/documentTruth/recomputeDealDocumentState";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/deals/backfill-document-state
 *
 * Phase 67: Backfill canonical document ledger for pre-Phase-66 deals.
 * Runs recomputeDealDocumentState on deals missing snapshots.
 *
 * Auth: requireSuperAdmin OR CRON_SECRET bearer token.
 *
 * Body (optional):
 *   { dealIds?: string[] }  — if provided, only backfill those deals
 */
export async function POST(req: NextRequest) {
  try {
    // Auth: super-admin OR cron secret
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isCron) {
      try {
        await requireSuperAdmin();
      } catch {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const explicitDealIds: string[] | undefined = body.dealIds;

    const sb = supabaseAdmin();
    let toBackfill: { id: string }[];

    if (explicitDealIds && explicitDealIds.length > 0) {
      // Backfill specific deals (e.g., Samaritus test deal)
      toBackfill = explicitDealIds.map((id) => ({ id }));
    } else {
      // Find all active deals missing snapshots
      const { data: allDeals } = await sb
        .from("deals")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(200);

      const { data: existingSnapshots } = await sb
        .from("deal_document_snapshots")
        .select("deal_id");

      const existingSet = new Set(
        (existingSnapshots ?? []).map((s: { deal_id: string }) => s.deal_id),
      );

      toBackfill = (allDeals ?? [])
        .filter((d: { id: string }) => !existingSet.has(d.id))
        .slice(0, 100);
    }

    const results: { dealId: string; ok: boolean; error?: string }[] = [];

    for (const deal of toBackfill) {
      try {
        await recomputeDealDocumentState(deal.id);
        results.push({ dealId: deal.id, ok: true });
      } catch (err) {
        console.error(`[backfill] failed for deal ${deal.id}:`, err);
        results.push({
          dealId: deal.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    return NextResponse.json({
      ok: true,
      total: toBackfill.length,
      succeeded,
      failed,
      results,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
