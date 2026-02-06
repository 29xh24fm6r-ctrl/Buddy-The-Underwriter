import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { backfillCanonicalFactsFromSpreads } from "@/lib/financialFacts/backfillFromSpreads";
import { getVisibleFacts } from "@/lib/financialFacts/getVisibleFacts";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/debug/deals/[dealId]/facts/recompute
 *
 * Admin-only endpoint that force-runs facts materialization for a deal.
 * Steps:
 *   1. Auth check (super admin only)
 *   2. Verify deal exists and look up bank_id
 *   3. Call backfillCanonicalFactsFromSpreads() directly
 *   4. Return facts visibility summary
 *
 * Use ?full=1 to also enqueue a spread recompute job before materialization.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { dealId } = await ctx.params;

  // Look up deal to get bank_id
  const sb = supabaseAdmin();
  const { data: deal, error: dealErr } = await (sb as any)
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr || !deal) {
    return NextResponse.json({ ok: false, error: "deal_not_found", dealId }, { status: 404 });
  }

  const bankId = String(deal.bank_id);

  // Optional: enqueue full spread recompute first
  const wantFull = req.nextUrl.searchParams.get("full") === "1";
  let enqueued = false;

  if (wantFull) {
    try {
      const { enqueueSpreadRecompute } = await import("@/lib/financialSpreads/enqueueSpreadRecompute");
      const allTypes = ["T12", "BALANCE_SHEET", "RENT_ROLL", "PERSONAL_INCOME", "PERSONAL_FINANCIAL_STATEMENT", "GLOBAL_CASH_FLOW"] as any[];
      const result = await enqueueSpreadRecompute({ dealId, bankId, spreadTypes: allTypes });
      enqueued = result.ok && (result as any).enqueued === true;
    } catch (e: any) {
      // Non-fatal — proceed with materialization from existing spreads
      console.warn("[debug/facts/recompute] Spread enqueue failed:", e?.message);
    }
  }

  logLedgerEvent({
    dealId,
    bankId,
    eventKey: "facts.recompute.requested",
    uiState: "working",
    uiMessage: `Admin facts recompute requested${wantFull ? " (full)" : ""}`,
    meta: { trigger: "debug_admin", full: wantFull, enqueued },
  }).catch(() => {});

  // Facts before
  const factsBefore = await getVisibleFacts(dealId, bankId);

  // Run materialization
  const backfill = await backfillCanonicalFactsFromSpreads({ dealId, bankId });

  // Facts after
  const factsAfter = await getVisibleFacts(dealId, bankId);

  logLedgerEvent({
    dealId,
    bankId,
    eventKey: backfill.ok ? "facts.recompute.completed" : "facts.recompute.failed",
    uiState: backfill.ok ? "done" : "error",
    uiMessage: backfill.ok
      ? `Admin recompute: ${backfill.factsWritten} facts materialized (${factsBefore.total}→${factsAfter.total})`
      : `Admin recompute failed: ${(backfill as any).error}`,
    meta: {
      trigger: "debug_admin",
      factsBefore: factsBefore.total,
      factsAfter: factsAfter.total,
      ...(backfill.ok
        ? { factsWritten: backfill.factsWritten, notes: backfill.notes }
        : { error: (backfill as any).error }),
    },
  }).catch(() => {});

  if (!backfill.ok) {
    return NextResponse.json({
      ok: false,
      dealId,
      error: (backfill as any).error,
      factsBefore: factsBefore.total,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    dealId,
    enqueued,
    factsWritten: backfill.factsWritten,
    notes: backfill.notes,
    factsBefore: factsBefore.total,
    factsAfter: factsAfter.total,
    facts: {
      total: factsAfter.total,
      by_owner_type: factsAfter.byOwnerType,
      by_fact_type: factsAfter.byFactType,
    },
  });
}
