import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
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

function extractMinStress(stress: any): number | null {
  const values = [
    stress?.stresses?.vacancyUp?.dscr,
    stress?.stresses?.rentDown?.dscr,
    stress?.stresses?.rateUp?.dscr,
  ].filter((v) => typeof v === "number");
  if (!values.length) return null;
  return Math.min(...(values as number[]));
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
        .select("id, borrower_name, deal_type")
        .eq("bank_id", bankId),
    ]);

    const latestSnapshots = pickLatestByDeal(snapshotsRes.data ?? []);
    const latestDecisions = pickLatestByDeal(decisionsRes.data ?? []);
    const latestScores = pickLatestByDeal(scoresRes.data ?? []);

    const rows = (dealsRes.data ?? []).map((deal) => {
      const snap = latestSnapshots[deal.id];
      if (!snap) return null;
      const snapshot = snap.snapshot_json as DealFinancialSnapshotV1;
      const decision = latestDecisions[deal.id];
      const score = latestScores[deal.id];

      return {
        deal_id: deal.id,
        borrower_name: (deal as any).borrower_name ?? null,
        deal_type: (deal as any).deal_type ?? null,
        dscr: snapshot.dscr?.value_num ?? null,
        stress_min: decision ? extractMinStress(decision.stress_json) : null,
        sba_status: decision?.sba_json?.status ?? null,
        score: score?.score ?? null,
        grade: score?.grade ?? null,
      };
    }).filter(Boolean);

    return NextResponse.json({ ok: true, bankId, rows });
  } catch (e: any) {
    console.error("[/api/portfolio/risk]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
