import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildPortfolioSummary } from "@/lib/portfolio/portfolioAnalytics";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickLatestByDeal<T extends { deal_id: string; created_at: string }>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const row of rows) {
    const existing = out[row.deal_id];
    if (!existing || existing.created_at < row.created_at) {
      out[row.deal_id] = row;
    }
  }
  return out;
}

export async function GET(_req: Request) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    const [snapshotsRes, decisionsRes, scoresRes, dealsRes] = await Promise.all([
      sb
        .from("financial_snapshots")
        .select("deal_id, snapshot_json, created_at")
        .eq("bank_id", bankId),
      sb
        .from("financial_snapshot_decisions")
        .select("deal_id, stress_json, sba_json, created_at")
        .eq("bank_id", bankId),
      sb
        .from("deal_underwriting_scores")
        .select("deal_id, score, grade, created_at")
        .eq("bank_id", bankId),
      sb
        .from("deals")
        .select("id, deal_type, geography")
        .eq("bank_id", bankId),
    ]);

    const latestSnapshots = pickLatestByDeal(snapshotsRes.data ?? []);
    const latestDecisions = pickLatestByDeal(decisionsRes.data ?? []);
    const latestScores = pickLatestByDeal(scoresRes.data ?? []);

    const rows = (dealsRes.data ?? []).map((deal) => {
      const snap = latestSnapshots[deal.id];
      if (!snap) return null;
      return {
        deal_id: deal.id,
        snapshot: snap.snapshot_json as DealFinancialSnapshotV1,
        decision: latestDecisions[deal.id]
          ? {
              stress: latestDecisions[deal.id].stress_json,
              sba: latestDecisions[deal.id].sba_json,
            }
          : null,
        score: latestScores[deal.id]
          ? { score: latestScores[deal.id].score, grade: latestScores[deal.id].grade }
          : null,
        deal: {
          deal_type: (deal as any).deal_type ?? null,
          geography: (deal as any).geography ?? null,
        },
      };
    }).filter(Boolean) as any;

    const summary = buildPortfolioSummary(rows);

    return NextResponse.json({ ok: true, bankId, summary });
  } catch (e: any) {
    console.error("[/api/portfolio/summary]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
