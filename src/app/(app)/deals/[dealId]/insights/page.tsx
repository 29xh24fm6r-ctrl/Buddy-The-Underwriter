"use client";

/**
 * Borrower Insights Page — Phase 66A (Commit 10)
 *
 * Displays borrower-facing financial insights:
 * - Business Health Summary (grade + score)
 * - What Changed (period-over-period)
 * - What Matters Most (loan-type-specific)
 * - Bankability Actions (improvement roadmap)
 * - Scenario Engine (what-if analysis)
 * - Peer Context (industry benchmarks)
 */

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

// ============================================================================
// Types (client-safe subset)
// ============================================================================

type HealthGrade = "A" | "B" | "C" | "D" | "F";

type InsightData = {
  dealId: string;
  generatedAt: string;
  healthSummary: {
    grade: HealthGrade;
    headline: string;
    strengths: string[];
    concerns: string[];
    overallScore: number;
  };
  whatChanged: {
    periodLabel: string;
    comparisonLabel: string;
    changes: {
      metric: string;
      label: string;
      changePct: number;
      direction: "improved" | "declined" | "stable";
      explanation: string;
    }[];
  } | null;
  whatMatters: {
    loanType: string;
    criticalMetrics: {
      metric: string;
      label: string;
      value: number;
      threshold: number;
      pass: boolean;
      whyItMatters: string;
    }[];
  };
  bankabilityActions: {
    priority: number;
    action: string;
    impact: string;
    difficulty: "easy" | "moderate" | "hard";
  }[];
  scenarios: {
    scenarioName: string;
    description: string;
    wouldPass: boolean;
    narrative: string;
  }[];
  peerContext: {
    naicsCode: string;
    industryLabel: string;
    metrics: {
      metric: string;
      label: string;
      borrowerValue: number;
      industryMedian: number;
      percentileRank: number;
      narrative: string;
    }[];
  } | null;
};

// ============================================================================
// Grade Badge
// ============================================================================

const GRADE_COLORS: Record<HealthGrade, string> = {
  A: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  B: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  C: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  D: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  F: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function GradeBadge({ grade, score }: { grade: HealthGrade; score: number }) {
  return (
    <div className="flex items-center gap-4">
      <span className={`text-4xl font-bold px-4 py-2 rounded-lg ${GRADE_COLORS[grade]}`}>
        {grade}
      </span>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Score: {score}/100
      </div>
    </div>
  );
}

// ============================================================================
// Page Component
// ============================================================================

export default function BorrowerInsightsPage() {
  const params = useParams();
  const dealId = params.dealId as string;

  const [data, setData] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/deals/${dealId}/borrower-insights`);
      if (!res.ok) {
        setError(res.status === 404 ? "No borrower insights available yet" : `Failed to load insights: ${res.status}`);
        return;
      }
      const json = await res.json();
      if (!json || !json.healthSummary || !json.whatMatters || !Array.isArray(json.bankabilityActions)) {
        setError("Borrower insights payload is incomplete");
        return;
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-red-600 dark:text-red-400">{error ?? "No insight data available"}</p>
        <button onClick={loadInsights} className="mt-2 text-blue-600 underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-4xl">
      <h1 className="text-2xl font-bold">Financial Insights</h1>

      {/* Health Summary */}
      <section className="border rounded-lg p-6 dark:border-gray-700">
        <h2 className="text-lg font-semibold mb-4">Business Health Summary</h2>
        <GradeBadge grade={data.healthSummary.grade} score={data.healthSummary.overallScore} />
        <p className="mt-4 text-gray-700 dark:text-gray-300">{data.healthSummary.headline}</p>

        {data.healthSummary.strengths.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-green-700 dark:text-green-400">Strengths</h3>
            <ul className="mt-1 list-disc list-inside text-sm text-gray-600 dark:text-gray-400">
              {data.healthSummary.strengths.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}

        {data.healthSummary.concerns.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-orange-700 dark:text-orange-400">Areas for Improvement</h3>
            <ul className="mt-1 list-disc list-inside text-sm text-gray-600 dark:text-gray-400">
              {data.healthSummary.concerns.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )}
      </section>

      {/* What Matters Most */}
      <section className="border rounded-lg p-6 dark:border-gray-700">
        <h2 className="text-lg font-semibold mb-4">What Matters Most</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Key metrics for your {data.whatMatters.loanType.replace(/_/g, " ")} loan
        </p>
        <div className="space-y-3">
          {data.whatMatters.criticalMetrics.map((m) => (
            <div key={m.metric} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded">
              <div>
                <span className="font-medium">{m.label}</span>
                <span className="ml-2 text-sm text-gray-500">{m.value.toFixed(2)}</span>
              </div>
              <span className={m.pass
                ? "text-sm text-green-600 dark:text-green-400"
                : "text-sm text-red-600 dark:text-red-400"
              }>
                {m.pass ? "Meets target" : `Below ${m.threshold.toFixed(2)} target`}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Bankability Actions */}
      {data.bankabilityActions.length > 0 && (
        <section className="border rounded-lg p-6 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4">Action Plan</h2>
          <div className="space-y-3">
            {data.bankabilityActions.map((a, i) => (
              <div key={i} className="p-3 bg-gray-50 dark:bg-gray-800 rounded">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded">
                    #{a.priority}
                  </span>
                  <span className="text-xs capitalize text-gray-500">{a.difficulty}</span>
                </div>
                <p className="mt-1 text-sm">{a.action}</p>
                <p className="text-xs text-gray-500 mt-1">{a.impact}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Scenarios */}
      {data.scenarios.length > 0 && (
        <section className="border rounded-lg p-6 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4">What-If Scenarios</h2>
          <div className="space-y-3">
            {data.scenarios.map((s, i) => (
              <div key={i} className="p-3 bg-gray-50 dark:bg-gray-800 rounded">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{s.scenarioName}</span>
                  <span className={s.wouldPass
                    ? "text-xs text-green-600 dark:text-green-400"
                    : "text-xs text-red-600 dark:text-red-400"
                  }>
                    {s.wouldPass ? "Would pass" : "Would not pass"}
                  </span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{s.narrative}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* What Changed */}
      {data.whatChanged && data.whatChanged.changes.length > 0 && (
        <section className="border rounded-lg p-6 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4">
            What Changed ({data.whatChanged.comparisonLabel} → {data.whatChanged.periodLabel})
          </h2>
          <div className="space-y-2">
            {data.whatChanged.changes.slice(0, 10).map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{c.label}</span>
                <span className={
                  c.direction === "improved" ? "text-green-600 dark:text-green-400" :
                  c.direction === "declined" ? "text-red-600 dark:text-red-400" :
                  "text-gray-500"
                }>
                  {c.direction === "stable" ? "Stable" : `${c.changePct > 0 ? "+" : ""}${c.changePct.toFixed(1)}%`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Generated {new Date(data.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}
