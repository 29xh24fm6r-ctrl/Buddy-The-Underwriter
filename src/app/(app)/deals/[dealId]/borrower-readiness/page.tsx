"use client";

/**
 * Enhanced Borrower Readiness Page — Phase 66B (Commit 9)
 *
 * God-tier borrower experience:
 * - Readiness Path with milestones + progress bars
 * - Cash Story narrative
 * - Ranked operational levers
 * - Credit metric translations
 * - Immediate actions
 */

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

// ============================================================================
// Types
// ============================================================================

type Milestone = {
  label: string;
  description: string;
  progress: number;
  actions: string[];
};

type RankedLever = {
  lever: string;
  description: string;
  feasibility: string;
  timeframe: string;
  lenderCareScore: number;
  rank: number;
};

type CashStory = {
  headline: string;
  paragraphs: string[];
  keyInsight: string;
  firstAction: string;
};

type CreditTranslation = {
  borrowerTerm: string;
  explanation: string;
  status: string;
  whatItMeans: string;
  whatToDoAboutIt: string;
};

type PageData = {
  path: { status: string; primaryConstraint: string; milestones: Milestone[] } | null;
  levers: RankedLever[];
  cashStory: CashStory | null;
  translations: CreditTranslation[];
  actions: { category: string; title?: string; description: string; confidence: string }[];
};

// ============================================================================
// Components
// ============================================================================

const STATUS_BADGE: Record<string, string> = {
  ready: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  on_track: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  at_risk: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  off_track: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

function MilestoneTracker({ milestones }: { milestones: Milestone[] }) {
  return (
    <div className="space-y-3">
      {milestones.map((m, i) => (
        <div key={i} className="border rounded-lg p-4 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-sm">{m.label}</span>
            <span className="text-xs text-gray-500">{m.progress}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-2">
            <div
              className={`h-2 rounded-full ${m.progress >= 100 ? "bg-green-500" : m.progress >= 50 ? "bg-blue-500" : "bg-orange-500"}`}
              style={{ width: `${Math.min(m.progress, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{m.description}</p>
          {m.actions.length > 0 && (
            <ul className="mt-2 text-xs text-gray-600 dark:text-gray-400 list-disc list-inside">
              {m.actions.slice(0, 3).map((a, j) => <li key={j}>{a}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function CashStorySection({ story }: { story: CashStory }) {
  return (
    <section className="border rounded-lg p-5 dark:border-gray-700">
      <h2 className="text-lg font-semibold mb-3">Your Cash Flow Story</h2>
      <p className="text-base font-medium text-gray-800 dark:text-gray-200 mb-3">{story.headline}</p>
      {story.paragraphs.map((p, i) => (
        <p key={i} className="text-sm text-gray-600 dark:text-gray-400 mb-2">{p}</p>
      ))}
      <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Key Insight</p>
        <p className="text-sm text-blue-700 dark:text-blue-400">{story.keyInsight}</p>
      </div>
      <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/30 rounded">
        <p className="text-sm font-medium text-green-800 dark:text-green-300">First Step</p>
        <p className="text-sm text-green-700 dark:text-green-400">{story.firstAction}</p>
      </div>
    </section>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function EnhancedBorrowerReadinessPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params?.dealId ?? "";
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/deals/${dealId}/borrower-readiness`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="p-6 animate-pulse"><div className="h-48 bg-gray-200 dark:bg-gray-700 rounded" /></div>;
  }
  if (!data) {
    return <div className="p-6 text-gray-500">Readiness data is being prepared.</div>;
  }

  return (
    <div className="p-6 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Your Lending Readiness</h1>
        {data.path && (
          <div className="flex items-center gap-3 mt-2">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_BADGE[data.path.status] ?? ""}`}>
              {data.path.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
            <span className="text-sm text-gray-500">Primary focus: {data.path.primaryConstraint}</span>
          </div>
        )}
      </div>

      {data.cashStory && <CashStorySection story={data.cashStory} />}

      {data.path && data.path.milestones.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Your Milestones</h2>
          <MilestoneTracker milestones={data.path.milestones} />
        </section>
      )}

      {data.levers.length > 0 && (
        <section className="border rounded-lg p-5 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-3">What You Can Do</h2>
          <div className="space-y-3">
            {data.levers.slice(0, 5).map((l) => (
              <div key={l.rank} className="flex gap-3 items-start">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 text-xs flex items-center justify-center font-mono">{l.rank}</span>
                <div>
                  <p className="text-sm font-medium">{l.lever}</p>
                  <p className="text-xs text-gray-500">{l.description}</p>
                  <div className="flex gap-3 mt-1 text-xs text-gray-400">
                    <span>Difficulty: {l.feasibility}</span>
                    <span>Timeline: {l.timeframe}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.translations.length > 0 && (
        <section className="border rounded-lg p-5 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-3">What Lenders Look At</h2>
          <div className="space-y-3">
            {data.translations.map((t, i) => (
              <div key={i} className="p-3 bg-gray-50 dark:bg-gray-800 rounded">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{t.borrowerTerm}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    t.status === "strong" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                    t.status === "adequate" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"
                  }`}>{t.status}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{t.whatItMeans}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.actions.length > 0 && (
        <section className="border rounded-lg p-5 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-3">Immediate Actions</h2>
          {data.actions.slice(0, 5).map((a, i) => (
            <div key={i} className="p-3 bg-gray-50 dark:bg-gray-800 rounded mb-2">
              <p className="text-sm font-medium">{a.title ?? a.category.replace(/_/g, " ")}</p>
              <p className="text-xs text-gray-500 mt-0.5">{a.description}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
