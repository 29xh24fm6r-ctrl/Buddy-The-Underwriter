"use client";

import { useEffect, useState } from "react";
import type { SimRun, SimResultRecord } from "@/lib/preapproval/types";

interface Props {
  dealId: string;
}

interface ParsedResult {
  id: string;
  sba_outcome: any;
  conventional_outcome: any;
  offers: any[];
  punchlist: any;
  truth: any;
  confidence: number;
  created_at: string;
}

interface StatusResponse {
  ok: boolean;
  run: SimRun | null;
  result: ParsedResult | null;
  error?: string;
}

export default function PreapprovalSimulator({ dealId }: Props) {
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Start simulation run
   */
  async function runSimulation() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/deals/${dealId}/preapproval/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "DUAL" }),
      });

      const data = await res.json();

      if (!data.ok || !data.run_id) {
        throw new Error(data.error || "Failed to start simulation");
      }

      setRunId(data.run_id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Poll simulation status
   */
  useEffect(() => {
    if (!runId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/preapproval/status?runId=${runId}`);
        const data = await res.json();

        setStatus(data);

        // Stop polling if completed or failed
        if (data.run?.status !== "running") {
          clearInterval(interval);
        }
      } catch (err: any) {
        console.error("Failed to fetch status:", err);
        setError(err.message);
        clearInterval(interval);
      }
    }, 1000); // Poll every second

    return () => clearInterval(interval);
  }, [runId, dealId]);

  const isRunning = status?.run?.status === "running";
  const result = status?.result;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pre-Approval Simulator</h1>
          <p className="text-sm text-gray-600 mt-1">
            See what you qualify for before applying — no promises, just possibilities.
          </p>
        </div>
        <button
          onClick={runSimulation}
          disabled={loading || isRunning}
          className="px-6 py-3 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Starting..." : isRunning ? "Running..." : "Run Simulator"}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <div className="flex items-center gap-2">
            <span className="text-red-600 font-medium">Error:</span>
            <span className="text-red-700">{error}</span>
          </div>
        </div>
      )}

      {/* Run Status */}
      {status?.run && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${
                status.run.status === "running" ? "bg-blue-500 animate-pulse" :
                status.run.status === "succeeded" ? "bg-green-500" :
                "bg-red-500"
              }`} />
              <div className="text-sm">
                <span className="font-medium">Status:</span>{" "}
                <span className="capitalize">{status.run.status}</span>
                {" • "}
                <span className="font-medium">Stage:</span>{" "}
                {status.run.current_stage}
              </div>
            </div>
            <div className="text-sm text-gray-600">
              Progress: {status.run.progress}%
            </div>
          </div>

          {/* Progress Bar */}
          {isRunning && (
            <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${status.run.progress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Outcomes Grid */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* SBA Outcome */}
            <div className={`rounded-xl border p-6 ${
              result.sba_outcome.status === "pass" ? "border-green-300 bg-green-50" :
              result.sba_outcome.status === "conditional" ? "border-yellow-300 bg-yellow-50" :
              "border-red-300 bg-red-50"
            }`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">SBA Outcome</h2>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  result.sba_outcome.status === "pass" ? "bg-green-200 text-green-800" :
                  result.sba_outcome.status === "conditional" ? "bg-yellow-200 text-yellow-800" :
                  "bg-red-200 text-red-800"
                }`}>
                  {result.sba_outcome.status.toUpperCase()}
                </span>
              </div>
              <ul className="space-y-3">
                {result.sba_outcome.reasons?.map((r: any, i: number) => (
                  <li key={i} className="text-sm">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-gray-700 mt-1">{r.detail}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Confidence: {(r.confidence * 100).toFixed(0)}%
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Conventional Outcome */}
            <div className={`rounded-xl border p-6 ${
              result.conventional_outcome.status === "pass" ? "border-green-300 bg-green-50" :
              result.conventional_outcome.status === "conditional" ? "border-yellow-300 bg-yellow-50" :
              "border-red-300 bg-red-50"
            }`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Conventional Outcome</h2>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  result.conventional_outcome.status === "pass" ? "bg-green-200 text-green-800" :
                  result.conventional_outcome.status === "conditional" ? "bg-yellow-200 text-yellow-800" :
                  "bg-red-200 text-red-800"
                }`}>
                  {result.conventional_outcome.status.toUpperCase()}
                </span>
              </div>
              <ul className="space-y-3">
                {result.conventional_outcome.reasons?.map((r: any, i: number) => (
                  <li key={i} className="text-sm">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-gray-700 mt-1">{r.detail}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Confidence: {(r.confidence * 100).toFixed(0)}%
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Offers */}
          {result.offers && result.offers.length > 0 && (
            <div className="rounded-xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold mb-4">Simulated Loan Options</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {result.offers.map((offer: any, i: number) => (
                  <div key={i} className="rounded-lg border p-4 hover:border-blue-300 transition-colors">
                    <div className="font-medium text-lg mb-2">{offer.product}</div>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-gray-600">Amount:</span>{" "}
                        <span className="font-medium">
                          ${offer.amount_range.min.toLocaleString()} - ${offer.amount_range.max.toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Term:</span>{" "}
                        <span className="font-medium">
                          {offer.term_months_range.min}-{offer.term_months_range.max} months
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded mt-2">
                        {offer.rate_note}
                      </div>
                      <div className="mt-3">
                        <div className="font-medium text-gray-700">Constraints:</div>
                        <ul className="list-disc pl-5 text-gray-600 mt-1">
                          {offer.constraints?.map((c: string, j: number) => (
                            <li key={j}>{c}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="mt-3">
                        <div className="font-medium text-gray-700">Conditions:</div>
                        <ul className="list-disc pl-5 text-gray-600 mt-1">
                          {offer.conditions?.map((c: string, j: number) => (
                            <li key={j}>{c}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        Confidence: {(offer.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Punchlist */}
          {result.punchlist && (
            <div className="rounded-xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold mb-4">Next Steps</h2>
              <div className="grid gap-4 lg:grid-cols-3">
                {/* Borrower Actions */}
                <div>
                  <div className="font-medium text-blue-600 mb-2">📋 For You</div>
                  <ul className="space-y-2 text-sm">
                    {result.punchlist.borrower_actions?.map((action: string, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Banker Actions */}
                <div>
                  <div className="font-medium text-green-600 mb-2">💼 For Banker</div>
                  <ul className="space-y-2 text-sm">
                    {result.punchlist.banker_actions?.map((action: string, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">•</span>
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* System Reviews */}
                <div>
                  <div className="font-medium text-purple-600 mb-2">⚙️ System Reviews</div>
                  <ul className="space-y-2 text-sm">
                    {result.punchlist.system_reviews?.map((action: string, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-purple-500 mt-0.5">•</span>
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Overall Confidence */}
          <div className="rounded-lg bg-gradient-to-r from-blue-50 to-purple-50 p-4 border">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-medium">Overall Simulation Confidence:</span>
                <span className="text-gray-600 ml-2">
                  Based on data completeness and connection quality
                </span>
              </div>
              <div className="text-2xl font-bold text-blue-600">
                {(result.confidence * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!status && (
        <div className="rounded-xl border-2 border-dashed bg-gray-50 p-12 text-center">
          <div className="text-gray-400 mb-4">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Ready to simulate?</h3>
          <p className="text-sm text-gray-600 max-w-md mx-auto">
            Click "Run Simulator" to see SBA and Conventional loan options based on your current data.
            This is a simulation only — not a promise of approval.
          </p>
        </div>
      )}
    </div>
  );
}
