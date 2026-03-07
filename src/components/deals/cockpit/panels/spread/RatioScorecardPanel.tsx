"use client";

import type { RatioScorecardReport, RatioGroup, RatioScorecardItem, RatioAssessment } from "@/lib/spreadOutput/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ASSESSMENT_STYLES_DARK: Record<string, { bg: string; text: string; label: string }> = {
  strong: { bg: "bg-green-900/30", text: "text-green-400", label: "Strong" },
  adequate: { bg: "bg-blue-900/30", text: "text-blue-400", label: "Adequate" },
  weak: { bg: "bg-amber-900/30", text: "text-amber-400", label: "Weak" },
  concerning: { bg: "bg-red-900/30", text: "text-red-400", label: "Concerning" },
};

const ASSESSMENT_STYLES_LIGHT: Record<string, { bg: string; text: string; label: string }> = {
  strong: { bg: "bg-green-50", text: "text-green-700", label: "Strong" },
  adequate: { bg: "bg-blue-50", text: "text-blue-700", label: "Adequate" },
  weak: { bg: "bg-amber-50", text: "text-amber-700", label: "Weak" },
  concerning: { bg: "bg-red-50", text: "text-red-700", label: "Concerning" },
};

const OVERALL_STYLES_DARK: Record<string, { bg: string; text: string }> = {
  strong: { bg: "bg-green-900/30 border-green-700", text: "text-green-300" },
  adequate: { bg: "bg-blue-900/30 border-blue-700", text: "text-blue-300" },
  marginal: { bg: "bg-amber-900/30 border-amber-700", text: "text-amber-300" },
  insufficient: { bg: "bg-red-900/30 border-red-700", text: "text-red-300" },
};

const OVERALL_STYLES_LIGHT: Record<string, { bg: string; text: string }> = {
  strong: { bg: "bg-green-50 border-green-300", text: "text-green-700" },
  adequate: { bg: "bg-blue-50 border-blue-300", text: "text-blue-700" },
  marginal: { bg: "bg-amber-50 border-amber-300", text: "text-amber-700" },
  insufficient: { bg: "bg-red-50 border-red-300", text: "text-red-700" },
};

const TREND_DISPLAY: Record<string, { icon: string; color: string }> = {
  improving: { icon: "\u2191", color: "text-green-400" },
  stable: { icon: "\u2192", color: "text-zinc-400" },
  deteriorating: { icon: "\u2193", color: "text-red-400" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RatioScorecardPanel({ scorecard, theme = "dark" }: { scorecard: RatioScorecardReport; theme?: "dark" | "light" }) {
  const light = theme === "light";
  const overallStyles = light ? OVERALL_STYLES_LIGHT : OVERALL_STYLES_DARK;
  const overall = overallStyles[scorecard.overall_assessment];

  return (
    <div className="space-y-4">
      {/* Overall assessment banner */}
      <div className={`rounded-lg border p-3 ${overall.bg}`}>
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium ${light ? "text-gray-500" : "text-zinc-400"}`}>Overall Ratio Assessment</span>
          <span className={`text-sm font-bold ${overall.text}`}>
            {scorecard.overall_assessment.charAt(0).toUpperCase() + scorecard.overall_assessment.slice(1)}
          </span>
        </div>
      </div>

      {/* Ratio groups */}
      {scorecard.groups.map((group) => (
        <RatioGroupSection key={group.group_name} group={group} light={light} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RatioGroupSection({ group, light = false }: { group: RatioGroup; light?: boolean }) {
  return (
    <div className={`rounded-lg border ${light ? "border-gray-200 bg-white" : "border-zinc-700 bg-zinc-800/30"}`}>
      <div className={`border-b px-3 py-2 ${light ? "border-gray-200" : "border-zinc-700"}`}>
        <h4 className={`text-xs font-bold uppercase tracking-wider ${light ? "text-gray-500" : "text-zinc-400"}`}>
          {group.group_name}
        </h4>
      </div>
      <div className={`divide-y ${light ? "divide-gray-100" : "divide-zinc-800"}`}>
        {group.ratios.map((ratio) => (
          <RatioRow key={ratio.canonical_key} ratio={ratio} light={light} />
        ))}
      </div>
    </div>
  );
}

function RatioRow({ ratio, light = false }: { ratio: RatioScorecardItem; light?: boolean }) {
  const assessmentStyles = light ? ASSESSMENT_STYLES_LIGHT : ASSESSMENT_STYLES_DARK;
  const style = ratio.assessment ? assessmentStyles[ratio.assessment] : null;
  const trend = ratio.trend ? TREND_DISPLAY[ratio.trend] : null;

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${light ? "text-gray-800" : "text-zinc-200"}`}>{ratio.label}</span>
          {trend && (
            <span className={`text-xs ${trend.color}`} title={ratio.trend ?? ""}>
              {trend.icon}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${light ? "text-gray-900" : "text-zinc-100"}`}>{ratio.formatted_value}</span>
          {style && (
            <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}>
              {style.label}
            </span>
          )}
          {ratio.passes_policy !== null && (
            <PolicyBadge passes={ratio.passes_policy} />
          )}
        </div>
      </div>

      {/* Percentile bar */}
      {ratio.percentile !== null && (
        <div className="mt-1.5">
          <PercentileBar percentile={ratio.percentile} assessment={ratio.assessment} light={light} />
          <div className={`mt-0.5 flex justify-between text-xs ${light ? "text-gray-400" : "text-zinc-500"}`}>
            <span>0th</span>
            {ratio.peer_median !== null && (
              <span>Peer median: {ratio.peer_median.toFixed(2)}</span>
            )}
            <span>100th</span>
          </div>
        </div>
      )}

      {/* Narrative */}
      {ratio.narrative && (
        <p className={`mt-1 text-xs ${light ? "text-gray-500" : "text-zinc-400"}`}>{ratio.narrative}</p>
      )}
    </div>
  );
}

function PercentileBar({ percentile, assessment, light = false }: { percentile: number; assessment: RatioAssessment; light?: boolean }) {
  const barColor =
    assessment === "strong"
      ? "bg-green-500"
      : assessment === "adequate"
        ? "bg-blue-500"
        : assessment === "weak"
          ? "bg-amber-500"
          : assessment === "concerning"
            ? "bg-red-500"
            : "bg-zinc-500";

  return (
    <div className={`relative h-2 w-full rounded-full ${light ? "bg-gray-200" : "bg-zinc-700"}`}>
      <div
        className={`absolute left-0 top-0 h-full rounded-full ${barColor}`}
        style={{ width: `${Math.min(100, Math.max(0, percentile))}%` }}
      />
      {/* Median marker */}
      <div className={`absolute top-0 h-full w-px ${light ? "bg-gray-400" : "bg-zinc-400"}`} style={{ left: "50%" }} />
    </div>
  );
}

function PolicyBadge({ passes }: { passes: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
        passes
          ? "bg-green-900/30 text-green-400"
          : "bg-red-900/30 text-red-400"
      }`}
    >
      {passes ? "Pass" : "Fail"}
    </span>
  );
}
