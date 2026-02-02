import StitchSurface from "@/stitch/StitchSurface";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildPortfolioSummary } from "@/lib/portfolio/portfolioAnalytics";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";
import {
  GlassShell,
  GlassPageHeader,
  GlassStatCard,
  GlassPanel,
  GlassTable,
  GlassTableHeader,
  GlassTableHeaderCell,
  GlassTableBody,
  GlassTableRow,
  GlassTableCell,
} from "@/components/layout";

export const dynamic = "force-dynamic";

export default async function Page() {
  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) redirect("/select-bank");
  const bankId = bankPick.bankId;
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
      .select("id, borrower_name, deal_type, geography")
      .eq("bank_id", bankId),
  ]);

  const latestByDeal = <T extends { deal_id: string; created_at: string }>(rows: T[]) => {
    const out: Record<string, T> = {};
    for (const row of rows) {
      const existing = out[row.deal_id];
      if (!existing || existing.created_at < row.created_at) {
        out[row.deal_id] = row;
      }
    }
    return out;
  };

  const latestSnapshots = latestByDeal(snapshotsRes.data ?? []);
  const latestDecisions = latestByDeal(decisionsRes.data ?? []);
  const latestScores = latestByDeal(scoresRes.data ?? []);

  const rows = (dealsRes.data ?? [])
    .map((deal) => {
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
        borrower_name: (deal as any).borrower_name ?? null,
      };
    })
    .filter(Boolean) as any[];

  const summary = buildPortfolioSummary(rows as any);

  return (
    <GlassShell maxWidth="6xl">
      <GlassPageHeader
        title="Portfolio Analytics"
        subtitle="Investor-grade rollup from versioned snapshots"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <GlassStatCard
          label="Total Exposure"
          value={`$${summary.totalExposure.toFixed(0)}`}
        />
        <GlassStatCard
          label="Weighted Avg DSCR"
          value={summary.weightedAvgDscr ?? "—"}
        />
        <GlassStatCard
          label="Stress Survival Rate"
          value={summary.stressSurvivalRate != null ? `${summary.stressSurvivalRate}%` : "—"}
        />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <GlassPanel header="Grade Distribution">
          <div className="space-y-2">
            {Object.entries(summary.gradeDistribution).map(([grade, count]) => (
              <div key={grade} className="flex items-center justify-between text-sm">
                <span className="text-white/70">{grade}</span>
                <span className="font-medium text-white">{count}</span>
              </div>
            ))}
          </div>
        </GlassPanel>
        <GlassPanel header="SBA Eligibility Rate">
          <div className="text-2xl font-semibold text-white">
            {summary.sbaEligibilityRate != null ? `${summary.sbaEligibilityRate}%` : "—"}
          </div>
        </GlassPanel>
      </div>

      <GlassPanel header="Deal Rollup" className="mt-6">
        <GlassTable>
          <GlassTableHeader>
            <GlassTableHeaderCell>Borrower</GlassTableHeaderCell>
            <GlassTableHeaderCell>DSCR</GlassTableHeaderCell>
            <GlassTableHeaderCell>Grade</GlassTableHeaderCell>
            <GlassTableHeaderCell>Asset</GlassTableHeaderCell>
          </GlassTableHeader>
          <GlassTableBody>
            {rows.slice(0, 20).map((row) => (
              <GlassTableRow key={row.deal_id}>
                <GlassTableCell>{row.borrower_name ?? row.deal_id}</GlassTableCell>
                <GlassTableCell>{row.snapshot?.dscr?.value_num ?? "—"}</GlassTableCell>
                <GlassTableCell>{row.score?.grade ?? "—"}</GlassTableCell>
                <GlassTableCell>{row.deal?.deal_type ?? "—"}</GlassTableCell>
              </GlassTableRow>
            ))}
          </GlassTableBody>
        </GlassTable>
      </GlassPanel>

      <div className="mt-8">
        <StitchSurface surfaceKey="portfolio" title="Portfolio" mode="iframe" />
      </div>
    </GlassShell>
  );
}
