"use client";

/**
 * Phase 56 — Borrower Financial Health Report Panel
 */

import { useCallback, useEffect, useState } from "react";

type Props = { dealId: string };

const SCORE_COLORS: Record<string, string> = {
  A: "text-emerald-400", B: "text-blue-400", C: "text-yellow-400", D: "text-amber-400", F: "text-red-400",
};

function compositeColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-yellow-400";
  if (score >= 25) return "text-amber-400";
  return "text-red-400";
}

export default function BorrowerReportPanel({ dealId }: Props) {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower-report/latest`);
      const json = await res.json();
      if (json.ok) setReport(json.report);
    } catch {}
    finally { setLoading(false); }
  }, [dealId]);

  useEffect(() => { fetchLatest(); }, [fetchLatest]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await fetch(`/api/deals/${dealId}/borrower-report/generate`, { method: "POST" });
      await fetchLatest();
    } finally { setGenerating(false); }
  }

  if (loading) return <div className="text-center text-white/40 py-8 text-sm">Loading...</div>;

  if (!report) {
    return (
      <div className="glass-card rounded-xl p-6 text-center space-y-3">
        <p className="text-white/40 text-sm">No borrower report generated yet.</p>
        <button onClick={handleGenerate} disabled={generating}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50">
          {generating ? "Generating..." : "Generate Borrower Report"}
        </button>
      </div>
    );
  }

  const composite = report.health_score_composite ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/90">Borrower Financial Health Report</h3>
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-white/5 border border-white/10 text-white/50">
          {report.status}
        </span>
      </div>

      {/* Health Score Card */}
      <div className="glass-card rounded-xl p-5">
        <div className="text-center mb-4">
          <p className="text-[10px] text-white/40 uppercase">Overall Financial Health Score</p>
          <p className={`text-4xl font-bold ${compositeColor(composite)}`}>{composite}</p>
          <p className="text-xs text-white/40">out of 100</p>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Profitability", score: report.health_score_profitability },
            { label: "Liquidity", score: report.health_score_liquidity },
            { label: "Leverage", score: report.health_score_leverage },
            { label: "Efficiency", score: report.health_score_efficiency },
          ].map((c) => (
            <div key={c.label} className="text-center">
              <p className="text-lg font-bold text-white/70">{c.score ?? 0}/25</p>
              <p className="text-[10px] text-white/40">{c.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Altman Z-Score */}
      {report.altman_z_score != null && (
        <div className="glass-card rounded-xl p-4 flex items-center gap-4">
          <div>
            <p className="text-[10px] text-white/40 uppercase">Altman Z-Score</p>
            <p className={`text-xl font-bold ${
              report.altman_zone === "safe" ? "text-emerald-400" :
              report.altman_zone === "grey" ? "text-yellow-400" : "text-red-400"
            }`}>{Number(report.altman_z_score).toFixed(2)}</p>
          </div>
          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${
            report.altman_zone === "safe" ? "bg-emerald-500/20 text-emerald-400" :
            report.altman_zone === "grey" ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"
          }`}>{report.altman_zone} zone</span>
        </div>
      )}

      {/* Strengths */}
      {report.strengths?.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <h4 className="text-xs font-semibold text-white/70 uppercase mb-2">Strengths</h4>
          {report.strengths.map((s: any, i: number) => (
            <div key={i} className="py-1.5 border-b border-white/5 last:border-0">
              <p className="text-xs font-medium text-emerald-400">{s.title}</p>
              <p className="text-[11px] text-white/50">{s.detail}</p>
            </div>
          ))}
        </div>
      )}

      {/* Improvement Opportunities */}
      {report.improvement_opportunities?.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <h4 className="text-xs font-semibold text-white/70 uppercase mb-2">Improvement Opportunities</h4>
          {report.improvement_opportunities.map((o: any, i: number) => (
            <div key={i} className="py-2 border-b border-white/5 last:border-0">
              <p className="text-xs font-medium text-amber-400">{o.title}</p>
              <p className="text-[11px] text-white/50">{o.detail}</p>
              {o.recommendation && <p className="text-[11px] text-white/40 mt-0.5 italic">{o.recommendation}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={handleGenerate} disabled={generating}
          className="px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-50">
          Re-generate
        </button>
      </div>
    </div>
  );
}
