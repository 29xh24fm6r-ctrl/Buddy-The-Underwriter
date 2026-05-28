import "server-only";

/**
 * POST /api/deals/[dealId]/financial-snapshot/rebuild
 *
 * SPEC-FINANCIAL-SNAPSHOT-HANDOFF-FIX-2: Direct retry action for the banker
 * when a spread job succeeded but financial_snapshots is empty.
 *
 * Thin wrapper: builds + persists the canonical financial snapshot from
 * existing facts + structural pricing. Does NOT re-run spreads or extraction.
 * Returns the snapshot ID so the pricing page can retry scenario generation.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  buildDealFinancialSnapshotForBank,
  persistCashFlowAvailableFromSnapshot,
} from "@/lib/deals/financialSnapshot";
import { persistFinancialSnapshot } from "@/lib/deals/financialSnapshotPersistence";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const bankId = access.bankId;

    // Pre-check: verify facts exist (no point building an empty snapshot)
    const sb = supabaseAdmin();
    const { count: factsCount } = await sb
      .from("deal_financial_facts")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected");

    if ((factsCount ?? 0) === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "no_facts",
          message:
            "No financial facts available. Upload financial documents and run spreads first.",
        },
        { status: 422 },
      );
    }

    // Build and persist
    const snapshot = await buildDealFinancialSnapshotForBank({ dealId, bankId });
    await persistCashFlowAvailableFromSnapshot({ dealId, bankId, snapshot });
    const snapRow = await persistFinancialSnapshot({ dealId, bankId, snapshot });

    // Recompute readiness so lifecycle picks up the new snapshot
    try {
      const { recomputeDealReady } = await import("@/lib/deals/readiness");
      await recomputeDealReady(dealId);
    } catch {
      // Non-fatal
    }

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "financial_snapshot.rebuilt",
      uiState: "done",
      uiMessage: "Financial snapshot rebuilt from existing facts",
      meta: {
        snapshotId: snapRow.id,
        completeness_pct: snapshot.completeness_pct,
      },
    });

    return NextResponse.json({
      ok: true,
      snapshot_id: snapRow.id,
      completeness_pct: snapshot.completeness_pct,
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[financial-snapshot/rebuild]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
