"use client";

/**
 * Phase 54 — Eval Dashboard
 *
 * Admin-only, gated by EVAL_DASHBOARD_ENABLED env var.
 */

import { useCallback, useEffect, useState } from "react";

type Run = {
  id: string;
  run_at: string;
  mode: string;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  overall_accuracy: number;
  duration_ms: number;
};

type Score = {
  case_id: string;
  case_name: string;
  passed: boolean;
  overall_score: number;
  fact_accuracy: number;
  ratio_accuracy: number;
  incorrect_facts: Array<{ key: string; expected: number; actual: number | null }>;
};

export default function EvalDashboard() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch("/api/evals/results");
      const data = await res.json();
      if (data.ok) {
        setRuns(data.runs ?? []);
        setScores(data.latestScores ?? []);
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  async function handleRun() {
    setRunning(true);
    try {
      await fetch("/api/evals/run", { method: "POST" });
      await fetchResults();
    } finally { setRunning(false); }
  }

  const latest = runs[0];
  const prev = runs[1];
  const regression = latest && prev && latest.overall_accuracy < prev.overall_accuracy - 0.05;

  return (
    <div className="p-6 space-y-6 min-h-screen">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white/90">Eval Dashboard</h1>
        <button onClick={handleRun} disabled={running}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50">
          {running ? "Running..." : "Run Eval Suite"}
        </button>
      </div>

      {regression && (
        <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
          Regression detected: accuracy dropped from {(prev.overall_accuracy * 100).toFixed(1)}% to {(latest.overall_accuracy * 100).toFixed(1)}%
        </div>
      )}

      {latest && (
        <div className="glass-card rounded-xl p-5 grid grid-cols-4 gap-4">
          <div>
            <p className="text-[10px] text-white/40 uppercase">Overall Accuracy</p>
            <p className="text-2xl font-bold text-white/90">{(latest.overall_accuracy * 100).toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase">Passed</p>
            <p className="text-2xl font-bold text-emerald-400">{latest.passed_cases}/{latest.total_cases}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase">Failed</p>
            <p className="text-2xl font-bold text-red-400">{latest.failed_cases}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase">Duration</p>
            <p className="text-2xl font-bold text-white/60">{latest.duration_ms}ms</p>
          </div>
        </div>
      )}

      {scores.length > 0 && (
        <div className="glass-card rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="glass-header">
              <tr>
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase">Case</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-20">Score</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-20">Facts</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-20">Ratios</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-16">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {scores.map((s) => (
                <tr key={s.case_id} className="glass-row">
                  <td className="px-4 py-2 text-xs text-white/70">{s.case_name}</td>
                  <td className="px-4 py-2 text-xs text-white/60">{(s.overall_score * 100).toFixed(0)}%</td>
                  <td className="px-4 py-2 text-xs text-white/60">{(s.fact_accuracy * 100).toFixed(0)}%</td>
                  <td className="px-4 py-2 text-xs text-white/60">{(s.ratio_accuracy * 100).toFixed(0)}%</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs font-bold ${s.passed ? "text-emerald-400" : "text-red-400"}`}>
                      {s.passed ? "PASS" : "FAIL"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && <p className="text-white/40 text-sm text-center py-8">Loading...</p>}
    </div>
  );
}
