import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { enqueueSpreadRecompute } from "@/lib/financialSpreads/enqueueSpreadRecompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 87 — GCF persisted-facts backfill
 *
 * Phase 86 (commit 9c53018e) added persistGcfComputedFacts() to renderSpread.ts,
 * which writes GCF_GLOBAL_CASH_FLOW / GCF_DSCR / GCF_CASH_AVAILABLE back into
 * deal_financial_facts after a GLOBAL_CASH_FLOW spread renders. That hook
 * only fires on future renders — existing deals still have null for these
 * facts.
 *
 * This endpoint re-enqueues the GLOBAL_CASH_FLOW spread for every deal that
 * already has one in "ready" status. When the spread recomputes,
 * persistGcfComputedFacts fires and the facts materialize. This is
 * spread-recompute only — document extraction is not re-run.
 *
 * POST body (all optional):
 *   - dryRun: boolean — preview the target set without enqueueing
 *   - limit:  number  — cap the number of (deal, bank) pairs processed
 */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin();

    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean(body?.dryRun);
    const limit = Number.isFinite(Number(body?.limit)) ? Number(body.limit) : 0;

    const sb = supabaseAdmin();

    // Grab every ready GCF spread. Group by (deal_id, bank_id) so we only
    // enqueue one recompute per deal+bank even if multiple owners have a
    // GCF spread (entity-scoped GCF is rare but possible).
    const { data: rows, error } = await (sb as any)
      .from("deal_spreads")
      .select("deal_id, bank_id")
      .eq("spread_type", "GLOBAL_CASH_FLOW")
      .eq("status", "ready");

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    const pairs = new Map<string, { dealId: string; bankId: string }>();
    for (const r of rows ?? []) {
      const key = `${r.deal_id}|${r.bank_id}`;
      if (!pairs.has(key)) {
        pairs.set(key, { dealId: String(r.deal_id), bankId: String(r.bank_id) });
      }
    }

    const targets = Array.from(pairs.values());
    const scope = limit > 0 ? targets.slice(0, limit) : targets;

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        totalReadyGcfSpreads: rows?.length ?? 0,
        uniqueDealBankPairs: targets.length,
        scopedForRun: scope.length,
      });
    }

    // Enqueue sequentially. enqueueSpreadRecompute is idempotent and will
    // merge into an existing active job per deal+bank rather than double-queue.
    let enqueued = 0;
    let merged = 0;
    const failures: Array<{ dealId: string; bankId: string; error: string }> = [];

    for (const t of scope) {
      try {
        const res = await enqueueSpreadRecompute({
          dealId: t.dealId,
          bankId: t.bankId,
          spreadTypes: ["GLOBAL_CASH_FLOW"],
          skipPrereqCheck: true,
          meta: { source: "phase_87_gcf_facts_backfill" },
        });
        if (res.ok) {
          if ("enqueued" in res && res.enqueued) enqueued += 1;
          else if ("merged" in res && res.merged) merged += 1;
        } else {
          failures.push({ dealId: t.dealId, bankId: t.bankId, error: res.error });
        }
      } catch (err: any) {
        failures.push({
          dealId: t.dealId,
          bankId: t.bankId,
          error: String(err?.message ?? err),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      totalReadyGcfSpreads: rows?.length ?? 0,
      uniqueDealBankPairs: targets.length,
      scopedForRun: scope.length,
      enqueued,
      merged,
      failed: failures.length,
      failures: failures.slice(0, 20),
    });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "unauthorized") {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if (msg === "forbidden") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
