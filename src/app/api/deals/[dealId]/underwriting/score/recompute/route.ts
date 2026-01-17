import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { computeDealScore } from "@/lib/scoring/dealScoringEngine";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();
    const { data: snapshotRow } = await sb
      .from("financial_snapshots")
      .select("id, snapshot_json")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!snapshotRow) {
      return NextResponse.json({ ok: false, error: "snapshot_not_found" }, { status: 404 });
    }

    const { data: decisionRow } = await sb
      .from("financial_snapshot_decisions")
      .select("stress_json, sba_json")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: deal } = await sb
      .from("deals")
      .select("*")
      .eq("id", dealId)
      .eq("bank_id", access.bankId)
      .maybeSingle();

    const snapshot = snapshotRow.snapshot_json as DealFinancialSnapshotV1;

    const score = computeDealScore({
      snapshot,
      decision: {
        stress: decisionRow?.stress_json ?? null,
        sba: decisionRow?.sba_json ?? null,
      },
      metadata: {
        assetType: (deal as any)?.deal_type ?? null,
        vintage: (deal as any)?.vintage ?? null,
        leverage: snapshot.ltv_net?.value_num ?? null,
      },
    });

    const { data: scoreRow, error } = await sb
      .from("deal_underwriting_scores")
      .insert({
        deal_id: dealId,
        bank_id: access.bankId,
        snapshot_id: snapshotRow.id,
        score: score.score,
        grade: score.grade,
        confidence: score.confidence,
        drivers_json: score.drivers,
      })
      .select("id, deal_id, snapshot_id, score, grade, confidence, drivers_json, created_at")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal_score_computed",
      uiState: "done",
      uiMessage: `Deal score ${score.grade} (${score.score}) computed`,
      meta: { snapshotId: snapshotRow.id, scoreId: scoreRow.id },
    });

    return NextResponse.json({ ok: true, dealId, score: scoreRow });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/underwriting/score/recompute]", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unexpected_error" }, { status: 500 });
  }
}
