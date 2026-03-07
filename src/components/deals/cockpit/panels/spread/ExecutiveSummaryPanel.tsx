"use client";

import type { ExecutiveSummary, RecommendationLevel } from "@/lib/spreadOutput/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REC_STYLES_DARK: Record<RecommendationLevel, { bg: string; text: string; label: string }> = {
  strong: { bg: "bg-green-900/30 border-green-700", text: "text-green-300", label: "Strong" },
  adequate: { bg: "bg-blue-900/30 border-blue-700", text: "text-blue-300", label: "Adequate" },
  marginal: { bg: "bg-amber-900/30 border-amber-700", text: "text-amber-300", label: "Marginal" },
  insufficient: { bg: "bg-red-900/30 border-red-700", text: "text-red-300", label: "Insufficient" },
};

const REC_STYLES_LIGHT: Record<RecommendationLevel, { bg: string; text: string; label: string }> = {
  strong: { bg: "bg-green-50 border-green-300", text: "text-green-700", label: "Strong" },
  adequate: { bg: "bg-blue-50 border-blue-300", text: "text-blue-700", label: "Adequate" },
  marginal: { bg: "bg-amber-50 border-amber-300", text: "text-amber-700", label: "Marginal" },
  insufficient: { bg: "bg-red-50 border-red-300", text: "text-red-700", label: "Insufficient" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExecutiveSummaryPanel({ summary, theme = "dark" }: { summary: ExecutiveSummary; theme?: "dark" | "light" }) {
  const light = theme === "light";
  const styles = light ? REC_STYLES_LIGHT : REC_STYLES_DARK;
  const style = styles[summary.recommendation_level];

  return (
    <div className="space-y-4">
      {/* Recommendation banner */}
      <div className={`rounded-lg border p-4 ${style.bg}`}>
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium ${light ? "text-gray-500" : "text-zinc-400"}`}>Credit Recommendation</span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${style.text}`}>
            {style.label}
          </span>
        </div>
        <p className={`mt-2 text-sm ${light ? "text-gray-800" : "text-zinc-200"}`}>{summary.recommendation_language}</p>
      </div>

      {/* 2x2 grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryCard title="Business Overview" content={summary.business_overview} light={light} />
        <SummaryCard title="Financial Snapshot" content={summary.financial_snapshot} light={light} />
        <SummaryCard title="Coverage & Debt Service" content={summary.coverage_summary} light={light} />
        <SummaryCard title="Collateral Position" content={summary.collateral_summary} light={light} />
      </div>

      {/* Risk flags summary */}
      {summary.risk_flags_summary && (
        <div className={`rounded-lg border p-3 ${light ? "border-gray-200 bg-gray-50" : "border-zinc-700 bg-zinc-800/50"}`}>
          <h4 className={`text-xs font-semibold uppercase ${light ? "text-gray-500" : "text-zinc-400"}`}>Risk Flags</h4>
          <p className={`mt-1 text-sm ${light ? "text-gray-700" : "text-zinc-300"}`}>{summary.risk_flags_summary}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({ title, content, light = false }: { title: string; content: string; light?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${light ? "border-gray-200 bg-gray-50" : "border-zinc-700 bg-zinc-800/50"}`}>
      <h4 className={`text-xs font-semibold uppercase ${light ? "text-gray-500" : "text-zinc-400"}`}>{title}</h4>
      <p className={`mt-1 text-sm ${light ? "text-gray-700" : "text-zinc-300"}`}>{content}</p>
    </div>
  );
}
