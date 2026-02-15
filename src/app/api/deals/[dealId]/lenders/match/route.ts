import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { matchLenders } from "@/lib/lenders/lenderMatchingEngine";
import { computeDealScore } from "@/lib/scoring/dealScoringEngine";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    const [{ data: snapshotRow }, { data: decisionRow }, { data: scoreRow }, { data: programs }, { data: deal }] =
      await Promise.all([
        sb
          .from("financial_snapshots")
          .select("id, snapshot_json")
          .eq("deal_id", dealId)
          .eq("bank_id", access.bankId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("financial_snapshot_decisions")
          .select("stress_json, sba_json")
          .eq("deal_id", dealId)
          .eq("bank_id", access.bankId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("deal_underwriting_scores")
          .select("id, score, grade")
          .eq("deal_id", dealId)
          .eq("bank_id", access.bankId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("lender_programs")
          .select("*")
          .eq("bank_id", access.bankId),
        sb
          .from("deals")
          .select("*")
          .eq("id", dealId)
          .eq("bank_id", access.bankId)
          .maybeSingle(),
      ]);

    if (!snapshotRow) {
      return NextResponse.json({ ok: false, error: "snapshot_not_found" }, { status: 404 });
    }

    const snapshot = snapshotRow.snapshot_json as DealFinancialSnapshotV1;

    let scoreValue = scoreRow?.score ?? null;
    if (scoreValue === null) {
      const computed = computeDealScore({
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

      const { data: inserted } = await sb
        .from("deal_underwriting_scores")
        .insert({
          deal_id: dealId,
          bank_id: access.bankId,
          snapshot_id: snapshotRow.id,
          score: computed.score,
          grade: computed.grade,
          confidence: computed.confidence,
          drivers_json: computed.drivers,
        })
        .select("id, score, grade")
        .single();

      scoreValue = inserted?.score ?? computed.score;
    }

    const result = matchLenders({
      snapshot,
      score: scoreValue,
      sbaStatus: decisionRow?.sba_json?.status ?? null,
      assetType: (deal as any)?.deal_type ?? null,
      geography: (deal as any)?.geography ?? (deal as any)?.state ?? null,
      programs: (programs ?? []) as any,
    });

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "lender_match_computed",
      uiState: "done",
      uiMessage: `Matched ${result.matched.length} lenders`,
      meta: { matched: result.matched.length },
    });

    return NextResponse.json({ ok: true, dealId, matches: result });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/lenders/match]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
