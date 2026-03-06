"use client";

import { useCallback, useEffect, useState } from "react";
import type { SpreadOutputReport } from "@/lib/spreadOutput/types";
import { ExecutiveSummaryPanel } from "./ExecutiveSummaryPanel";
import { NormalizedSpreadPanel } from "./NormalizedSpreadPanel";
import { RatioScorecardPanel } from "./RatioScorecardPanel";
import { StoryPanelView } from "./StoryPanelView";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabKey = "summary" | "spread" | "ratios" | "story";

const TABS: { key: TabKey; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "spread", label: "Spread" },
  { key: "ratios", label: "Ratios" },
  { key: "story", label: "Story" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SpreadOutputPanel({ dealId }: { dealId: string }) {
  const [tab, setTab] = useState<TabKey>("summary");
  const [report, setReport] = useState<SpreadOutputReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/deals/${dealId}/spread-output`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReport(data.report ?? null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load spread output";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Loading state
  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6 text-center">
        <div className="animate-pulse text-sm text-zinc-400">Loading spread output...</div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-4">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={fetchReport}
          className="mt-2 text-xs text-red-300 underline hover:text-red-200"
        >
          Retry
        </button>
      </div>
    );
  }

  // No data
  if (!report) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 text-center">
        <p className="text-sm text-zinc-400">
          No spread output available — financial data must be extracted and spread first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-zinc-700 bg-zinc-800/50 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.key
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "summary" && <ExecutiveSummaryPanel summary={report.executive_summary} />}
      {tab === "spread" && <NormalizedSpreadPanel spread={report.normalized_spread} />}
      {tab === "ratios" && <RatioScorecardPanel scorecard={report.ratio_scorecard} />}
      {tab === "story" && <StoryPanelView panel={report.story_panel} />}
    </div>
  );
}
