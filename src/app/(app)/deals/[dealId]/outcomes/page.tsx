"use client";

/**
 * Banker Outcome Dashboard — Phase 66C
 *
 * Panels:
 * - Recommendation Performance (acceptance rate, usefulness)
 * - Override Reasons (top overrides)
 * - Trust Drift (trust events over time)
 * - Outcome Uplift (readiness lift)
 * - Borrower Progress (action completion)
 */

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

// ============================================================================
// Types
// ============================================================================

type RecommendationOutcome = {
  id: string;
  recommendation_id: string;
  outcome_type: string;
  acceptance_status: string;
  usefulness_rating: number | null;
  override_reason: string | null;
  created_at: string;
};

type TrustEvent = {
  id: string;
  event_type: string;
  trust_delta: number;
  reason: string;
  evidence_json: Record<string, unknown> | null;
  created_at: string;
};

type UpliftSnapshot = {
  id: string;
  before_score: number;
  after_score: number;
  score_delta: number;
  contributing_factors_json: Record<string, unknown> | null;
  created_at: string;
};

type BorrowerAction = {
  id: string;
  action_type: string;
  action_category: string;
  status: string;
  completed_at: string | null;
  created_at: string;
};

type OutcomeData = {
  recommendations: RecommendationOutcome[];
  trustEvents: TrustEvent[];
  uplift: UpliftSnapshot[];
  borrowerActions: BorrowerAction[];
};

// ============================================================================
// Helpers
// ============================================================================

function formatLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

const STATUS_COLORS: Record<string, string> = {
  accepted: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
};

// ============================================================================
// Panel Components
// ============================================================================

function RecommendationPerformancePanel({
  recommendations,
}: {
  recommendations: RecommendationOutcome[];
}) {
  const total = recommendations.length;
  if (total === 0) {
    return (
      <section className="border rounded-lg p-4 dark:border-gray-700">
        <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">
          Recommendation Performance
        </h2>
        <p className="text-sm text-gray-400">No recommendation outcomes yet.</p>
      </section>
    );
  }

  const accepted = recommendations.filter(
    (r) => r.acceptance_status === "accepted",
  ).length;
  const acceptanceRate = accepted / total;

  const rated = recommendations.filter((r) => r.usefulness_rating != null);
  const avgUsefulness =
    rated.length > 0
      ? rated.reduce((sum, r) => sum + (r.usefulness_rating ?? 0), 0) /
        rated.length
      : 0;

  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">
        Recommendation Performance
      </h2>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-2xl font-bold">{pct(acceptanceRate)}</div>
          <div className="text-xs text-gray-500">Acceptance Rate</div>
        </div>
        <div>
          <div className="text-2xl font-bold">{avgUsefulness.toFixed(1)}</div>
          <div className="text-xs text-gray-500">Avg Usefulness</div>
        </div>
        <div>
          <div className="text-2xl font-bold">{total}</div>
          <div className="text-xs text-gray-500">Total Outcomes</div>
        </div>
      </div>
    </section>
  );
}

function OverrideReasonsPanel({
  recommendations,
}: {
  recommendations: RecommendationOutcome[];
}) {
  const overrides = recommendations.filter((r) => r.override_reason);
  if (overrides.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const r of overrides) {
    const reason = r.override_reason ?? "Unknown";
    counts[reason] = (counts[reason] ?? 0) + 1;
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">
        Top Override Reasons
      </h2>
      <div className="space-y-2">
        {sorted.map(([reason, count]) => (
          <div
            key={reason}
            className="flex items-center justify-between text-sm"
          >
            <span>{formatLabel(reason)}</span>
            <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
              {count}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TrustDriftPanel({ events }: { events: TrustEvent[] }) {
  if (events.length === 0) return null;

  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">
        Trust Drift
      </h2>
      <div className="space-y-2">
        {events.slice(0, 8).map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between text-sm"
          >
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-mono ${
                  e.trust_delta >= 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {e.trust_delta >= 0 ? "+" : ""}
                {e.trust_delta.toFixed(2)}
              </span>
              <span>{formatLabel(e.event_type)}</span>
            </div>
            <span className="text-xs text-gray-400">
              {new Date(e.created_at).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function OutcomeUpliftPanel({ uplift }: { uplift: UpliftSnapshot[] }) {
  if (uplift.length === 0) return null;

  const avgDelta =
    uplift.reduce((sum, u) => sum + u.score_delta, 0) / uplift.length;

  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">
        Outcome Uplift
      </h2>
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <div
            className={`text-2xl font-bold ${
              avgDelta >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {avgDelta >= 0 ? "+" : ""}
            {avgDelta.toFixed(1)}
          </div>
          <div className="text-xs text-gray-500">Avg Readiness Lift</div>
        </div>
        <div>
          <div className="text-2xl font-bold">{uplift.length}</div>
          <div className="text-xs text-gray-500">Snapshots</div>
        </div>
      </div>
      <div className="space-y-1">
        {uplift.slice(0, 5).map((u) => (
          <div key={u.id} className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">
              {u.before_score} &rarr; {u.after_score}
            </span>
            <span
              className={`font-medium ${
                u.score_delta >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              ({u.score_delta >= 0 ? "+" : ""}
              {u.score_delta})
            </span>
            <span className="text-gray-400">
              {new Date(u.created_at).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function BorrowerProgressPanel({ actions }: { actions: BorrowerAction[] }) {
  if (actions.length === 0) return null;

  const byStatus: Record<string, number> = {};
  for (const a of actions) {
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  }

  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">
        Borrower Progress
      </h2>
      <div className="flex gap-3 flex-wrap mb-3">
        {Object.entries(byStatus).map(([status, count]) => (
          <div key={status} className="text-center">
            <div className="text-lg font-bold">{count}</div>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                STATUS_COLORS[status] ??
                "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              }`}
            >
              {formatLabel(status)}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-1">
        {actions.slice(0, 5).map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between text-sm"
          >
            <span>{formatLabel(a.action_category)}</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                STATUS_COLORS[a.status] ?? ""
              }`}
            >
              {formatLabel(a.status)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function OutcomesPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const [data, setData] = useState<OutcomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/deals/${dealId}/outcomes`);
      if (!res.ok) throw new Error(`Failed to fetch outcomes: ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Outcome Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          How recommendations, trust, and borrower actions are performing.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <RecommendationPerformancePanel
          recommendations={data.recommendations}
        />
        <OverrideReasonsPanel recommendations={data.recommendations} />
        <TrustDriftPanel events={data.trustEvents} />
        <OutcomeUpliftPanel uplift={data.uplift} />
        <BorrowerProgressPanel actions={data.borrowerActions} />
      </div>
    </div>
  );
}
