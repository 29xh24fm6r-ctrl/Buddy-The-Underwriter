import StitchRouteBridge from "@/components/stitch/StitchRouteBridge";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildPortfolioSummary } from "@/lib/portfolio/portfolioAnalytics";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export const dynamic = "force-dynamic";

export default async function Page() {
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
    <div className="space-y-8">
      <div className="mx-auto w-full max-w-6xl px-6 pt-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Portfolio Analytics</h1>
            <p className="text-sm text-neutral-600">Investor-grade rollup from versioned snapshots.</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs text-neutral-500">Total Exposure</div>
            <div className="text-xl font-semibold text-neutral-900">
              ${summary.totalExposure.toFixed(0)}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs text-neutral-500">Weighted Avg DSCR</div>
            <div className="text-xl font-semibold text-neutral-900">
              {summary.weightedAvgDscr ?? "—"}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs text-neutral-500">Stress Survival Rate</div>
            <div className="text-xl font-semibold text-neutral-900">
              {summary.stressSurvivalRate != null ? `${summary.stressSurvivalRate}%` : "—"}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-sm font-semibold text-neutral-900">Grade Distribution</div>
            <div className="mt-2 space-y-1 text-sm text-neutral-600">
              {Object.entries(summary.gradeDistribution).map(([grade, count]) => (
                <div key={grade} className="flex items-center justify-between">
                  <span>{grade}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-sm font-semibold text-neutral-900">SBA Eligibility Rate</div>
            <div className="mt-2 text-xl font-semibold text-neutral-900">
              {summary.sbaEligibilityRate != null ? `${summary.sbaEligibilityRate}%` : "—"}
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-sm font-semibold text-neutral-900">Deal Rollup</div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs text-neutral-500">
                  <th className="py-2 text-left">Borrower</th>
                  <th className="py-2 text-left">DSCR</th>
                  <th className="py-2 text-left">Grade</th>
                  <th className="py-2 text-left">Asset</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((row) => (
                  <tr key={row.deal_id} className="border-t">
                    <td className="py-2 text-neutral-900">{row.borrower_name ?? row.deal_id}</td>
                    <td className="py-2 text-neutral-700">{row.snapshot?.dscr?.value_num ?? "—"}</td>
                    <td className="py-2 text-neutral-700">{row.score?.grade ?? "—"}</td>
                    <td className="py-2 text-neutral-700">{row.deal?.deal_type ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <StitchRouteBridge slug="portfolio-command-bridge" />
    </div>
  );
}
