"use client";

import { useState } from "react";

type Decision = {
  decision: string;
  summary: string;
  key_risks: string[];
  conditions: string[];
  missing_info: string[];
  confidence: number;
};

export default function AILabPage() {
  const [narrative, setNarrative] = useState("");
  const [deep, setDeep] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAnalysis() {
    if (!narrative.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/ai/underwrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          narrative,
          deep_reasoning: deep,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Request failed");
      }

      setResult(json.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">AI Lab</h1>
          <p className="mt-2 text-slate-400">Test Buddy's structured AI underwriting</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Input Panel */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Input</h2>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Deal Narrative
              </label>
              <textarea
                className="h-64 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Paste deal information, borrower details, financial data..."
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
              />
            </div>

            <div className="mb-4 flex items-center gap-3">
              <input
                type="checkbox"
                id="deep"
                checked={deep}
                onChange={(e) => setDeep(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-2 focus:ring-blue-500"
              />
              <label htmlFor="deep" className="text-sm text-slate-300">
                Deep reasoning (o1-preview)
              </label>
            </div>

            <button
              onClick={runAnalysis}
              disabled={loading || !narrative.trim()}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Analyzing..." : "Run Analysis"}
            </button>
          </div>

          {/* Output Panel */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Output</h2>

            {error && (
              <div className="rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">
                {error}
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {/* Decision */}
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                    Decision
                  </div>
                  <div className="rounded-lg bg-slate-800 px-3 py-2">
                    <span
                      className={`font-semibold ${
                        result.decision === "approve"
                          ? "text-emerald-400"
                          : result.decision === "decline"
                          ? "text-red-400"
                          : "text-yellow-400"
                      }`}
                    >
                      {result.decision.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Confidence */}
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                    Confidence
                  </div>
                  <div className="rounded-lg bg-slate-800 px-3 py-2 font-mono text-sm text-white">
                    {(result.confidence * 100).toFixed(0)}%
                  </div>
                </div>

                {/* Summary */}
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                    Summary
                  </div>
                  <div className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200">
                    {result.summary}
                  </div>
                </div>

                {/* Key Risks */}
                {result.key_risks.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                      Key Risks
                    </div>
                    <ul className="space-y-1 rounded-lg bg-slate-800 px-3 py-2">
                      {result.key_risks.map((risk, i) => (
                        <li key={i} className="text-sm text-red-300">
                          • {risk}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Conditions */}
                {result.conditions.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                      Conditions
                    </div>
                    <ul className="space-y-1 rounded-lg bg-slate-800 px-3 py-2">
                      {result.conditions.map((condition, i) => (
                        <li key={i} className="text-sm text-yellow-300">
                          • {condition}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Missing Info */}
                {result.missing_info.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                      Missing Information
                    </div>
                    <ul className="space-y-1 rounded-lg bg-slate-800 px-3 py-2">
                      {result.missing_info.map((info, i) => (
                        <li key={i} className="text-sm text-blue-300">
                          • {info}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {!result && !error && (
              <div className="flex h-64 items-center justify-center text-sm text-slate-500">
                Run an analysis to see results
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
