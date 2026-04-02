"use client";

/**
 * Borrower Progress Page — Phase 66C
 *
 * Borrower-friendly view of their journey toward loan readiness.
 * Panels:
 * - Action Progress (completed/in_progress/pending)
 * - Readiness Improvement (before/after scores)
 * - Milestone Velocity (completion rate over time)
 * - "What Helped Most" (top effective guidance categories)
 *
 * Tone: encouraging, no shaming.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

// ============================================================================
// Types
// ============================================================================

type BorrowerAction = {
  id: string;
  action_type: string;
  action_category: string;
  status: string;
  guidance_category: string | null;
  effectiveness_rating: number | null;
  completed_at: string | null;
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

type ProgressData = {
  actions: BorrowerAction[];
  uplift: UpliftSnapshot[];
  milestoneRate: number;
};

// ============================================================================
// Helpers
// ============================================================================

function formatLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function encouragingMessage(milestoneRate: number): string {
  if (milestoneRate >= 0.8) return "Outstanding progress! You are nearly there.";
  if (milestoneRate >= 0.6) return "Great momentum! Keep it up.";
  if (milestoneRate >= 0.3) return "Good start. Every step forward counts.";
  return "Your journey is just beginning. We are here to help every step of the way.";
}

const STATUS_STYLES: Record<string, { bg: string; label: string }> = {
  completed: {
    bg: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    label: "Completed",
  },
  in_progress: {
    bg: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    label: "In Progress",
  },
  pending: {
    bg: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    label: "Pending",
  },
};

// ============================================================================
// Panel Components
// ============================================================================

function ActionProgressPanel({ actions }: { actions: BorrowerAction[] }) {
  const completed = actions.filter((a) => a.status === "completed");
  const inProgress = actions.filter((a) => a.status === "in_progress");
  const pending = actions.filter(
    (a) => a.status !== "completed" && a.status !== "in_progress",
  );

  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">
        Your Action Progress
      </h2>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {completed.length}
          </div>
          <div className="text-xs text-gray-500">Completed</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {inProgress.length}
          </div>
          <div className="text-xs text-gray-500">In Progress</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-500">
            {pending.length}
          </div>
          <div className="text-xs text-gray-500">Pending</div>
        </div>
      </div>
      {actions.length > 0 && (
        <div className="space-y-1.5">
          {actions.slice(0, 6).map((a) => {
            const style =
              STATUS_STYLES[a.status] ?? STATUS_STYLES.pending;
            return (
              <div
                key={a.id}
                className="flex items-center justify-between text-sm"
              >
                <span>{formatLabel(a.action_category)}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${style.bg}`}
                >
                  {style.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReadinessImprovementPanel({ uplift }: { uplift: UpliftSnapshot[] }) {
  if (uplift.length === 0) {
    return (
      <section className="border rounded-lg p-4 dark:border-gray-700">
        <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">
          Readiness Improvement
        </h2>
        <p className="text-sm text-gray-400">
          Your readiness score will appear here as you make progress.
        </p>
      </section>
    );
  }

  const latest = uplift[0];
  const earliest = uplift[uplift.length - 1];
  const totalLift = latest.after_score - earliest.before_score;

  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">
        Readiness Improvement
      </h2>
      <div className="grid grid-cols-3 gap-4 mb-3">
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-500">
            {earliest.before_score}
          </div>
          <div className="text-xs text-gray-500">Starting Score</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">{latest.after_score}</div>
          <div className="text-xs text-gray-500">Current Score</div>
        </div>
        <div className="text-center">
          <div
            className={`text-2xl font-bold ${
              totalLift >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {totalLift >= 0 ? "+" : ""}
            {totalLift}
          </div>
          <div className="text-xs text-gray-500">Total Lift</div>
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

function MilestoneVelocityPanel({
  actions,
  milestoneRate,
}: {
  actions: BorrowerAction[];
  milestoneRate: number;
}) {
  const completedActions = actions.filter((a) => a.status === "completed");

  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">
        Milestone Velocity
      </h2>
      <div className="mb-3">
        <div className="flex items-end gap-2">
          <span className="text-2xl font-bold">
            {Math.round(milestoneRate * 100)}%
          </span>
          <span className="text-sm text-gray-500 mb-0.5">completion rate</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2">
          <div
            className="bg-green-500 dark:bg-green-400 h-2 rounded-full transition-all"
            style={{ width: `${Math.round(milestoneRate * 100)}%` }}
          />
        </div>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {encouragingMessage(milestoneRate)}
      </p>
      {completedActions.length > 0 && (
        <div className="mt-3 space-y-1">
          {completedActions.slice(0, 3).map((a) => (
            <div key={a.id} className="text-xs text-gray-500 flex gap-1">
              <span className="text-green-600 dark:text-green-400">
                &#10003;
              </span>
              <span>{formatLabel(a.action_category)}</span>
              {a.completed_at && (
                <span className="text-gray-400">
                  {new Date(a.completed_at).toLocaleDateString()}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function WhatHelpedMostPanel({ actions }: { actions: BorrowerAction[] }) {
  const effective = actions.filter(
    (a) =>
      a.guidance_category &&
      a.effectiveness_rating != null &&
      a.effectiveness_rating > 0,
  );

  if (effective.length === 0) return null;

  const byCategory: Record<string, { total: number; count: number }> = {};
  for (const a of effective) {
    const cat = a.guidance_category ?? "Other";
    if (!byCategory[cat]) byCategory[cat] = { total: 0, count: 0 };
    byCategory[cat].total += a.effectiveness_rating ?? 0;
    byCategory[cat].count += 1;
  }

  const sorted = Object.entries(byCategory)
    .map(([cat, v]) => ({ category: cat, avgRating: v.total / v.count }))
    .sort((a, b) => b.avgRating - a.avgRating)
    .slice(0, 5);

  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">
        What Helped Most
      </h2>
      <div className="space-y-2">
        {sorted.map((item) => (
          <div
            key={item.category}
            className="flex items-center justify-between text-sm"
          >
            <span>{formatLabel(item.category)}</span>
            <div className="flex items-center gap-1">
              <div className="w-20 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-blue-500 dark:bg-blue-400 h-1.5 rounded-full"
                  style={{
                    width: `${Math.min(100, Math.round(item.avgRating * 20))}%`,
                  }}
                />
              </div>
              <span className="text-xs text-gray-500 w-8 text-right">
                {item.avgRating.toFixed(1)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function BorrowerProgressPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/deals/${dealId}/borrower-progress`);
      if (!res.ok)
        throw new Error(`Failed to fetch borrower progress: ${res.status}`);
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
        <h1 className="text-lg font-semibold">Your Progress</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Track your journey toward loan readiness. Every step counts.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <ActionProgressPanel actions={data.actions} />
        <ReadinessImprovementPanel uplift={data.uplift} />
        <MilestoneVelocityPanel
          actions={data.actions}
          milestoneRate={data.milestoneRate}
        />
        <WhatHelpedMostPanel actions={data.actions} />
      </div>
    </div>
  );
}
