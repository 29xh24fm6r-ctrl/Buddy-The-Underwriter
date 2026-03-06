"use client";

import type { ExecutiveSummary, RecommendationLevel } from "@/lib/spreadOutput/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REC_STYLES: Record<RecommendationLevel, { bg: string; text: string; label: string }> = {
  strong: { bg: "bg-green-900/30 border-green-700", text: "text-green-300", label: "Strong" },
  adequate: { bg: "bg-blue-900/30 border-blue-700", text: "text-blue-300", label: "Adequate" },
  marginal: { bg: "bg-amber-900/30 border-amber-700", text: "text-amber-300", label: "Marginal" },
  insufficient: { bg: "bg-red-900/30 border-red-700", text: "text-red-300", label: "Insufficient" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExecutiveSummaryPanel({ summary }: { summary: ExecutiveSummary }) {
  const style = REC_STYLES[summary.recommendation_level];

  return (
    <div className="space-y-4">
      {/* Recommendation banner */}
      <div className={`rounded-lg border p-4 ${style.bg}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-400">Credit Recommendation</span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${style.text}`}>
            {style.label}
          </span>
        </div>
        <p className="mt-2 text-sm text-zinc-200">{summary.recommendation_language}</p>
      </div>

      {/* 2x2 grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryCard title="Business Overview" content={summary.business_overview} />
        <SummaryCard title="Financial Snapshot" content={summary.financial_snapshot} />
        <SummaryCard title="Coverage & Debt Service" content={summary.coverage_summary} />
        <SummaryCard title="Collateral Position" content={summary.collateral_summary} />
      </div>

      {/* Risk flags summary */}
      {summary.risk_flags_summary && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
          <h4 className="text-xs font-semibold uppercase text-zinc-400">Risk Flags</h4>
          <p className="mt-1 text-sm text-zinc-300">{summary.risk_flags_summary}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
      <h4 className="text-xs font-semibold uppercase text-zinc-400">{title}</h4>
      <p className="mt-1 text-sm text-zinc-300">{content}</p>
    </div>
  );
}
