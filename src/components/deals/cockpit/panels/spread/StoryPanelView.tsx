"use client";

import type { StoryPanel, StoryElement, CovenantSuggestion } from "@/lib/spreadOutput/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_STYLES_DARK: Record<string, { bg: string; text: string }> = {
  critical: { bg: "bg-red-900/30 border-red-700", text: "text-red-300" },
  elevated: { bg: "bg-amber-900/30 border-amber-700", text: "text-amber-300" },
  watch: { bg: "bg-yellow-900/30 border-yellow-700", text: "text-yellow-300" },
};

const SEVERITY_STYLES_LIGHT: Record<string, { bg: string; text: string }> = {
  critical: { bg: "bg-red-50 border-red-300", text: "text-red-700" },
  elevated: { bg: "bg-amber-50 border-amber-300", text: "text-amber-700" },
  watch: { bg: "bg-yellow-50 border-yellow-300", text: "text-yellow-700" },
};

const FREQ_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StoryPanelView({ panel, theme = "dark" }: { panel: StoryPanel; theme?: "dark" | "light" }) {
  const light = theme === "light";
  return (
    <div className="space-y-4">
      {/* Final narrative */}
      <div className={`rounded-lg border p-4 ${light ? "border-gray-200 bg-gray-50" : "border-zinc-700 bg-zinc-800/50"}`}>
        <h4 className={`text-xs font-semibold uppercase ${light ? "text-gray-500" : "text-zinc-400"}`}>Credit Narrative</h4>
        <p className={`mt-2 text-sm leading-relaxed ${light ? "text-gray-800" : "text-zinc-200"}`}>{panel.final_narrative}</p>
      </div>

      {/* 3-column: Risks / Strengths / Covenants */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* Risks */}
        <div className="space-y-2">
          <h4 className={`text-xs font-semibold uppercase ${light ? "text-red-600" : "text-red-400"}`}>Top Risks</h4>
          {panel.top_risks.length === 0 ? (
            <p className={`text-xs ${light ? "text-gray-400" : "text-zinc-500"}`}>No material risks identified</p>
          ) : (
            panel.top_risks.map((risk, i) => (
              <StoryCard key={i} element={risk} light={light} />
            ))
          )}
        </div>

        {/* Strengths */}
        <div className="space-y-2">
          <h4 className={`text-xs font-semibold uppercase ${light ? "text-green-600" : "text-green-400"}`}>Key Strengths</h4>
          {panel.top_strengths.length === 0 ? (
            <p className={`text-xs ${light ? "text-gray-400" : "text-zinc-500"}`}>No notable strengths identified</p>
          ) : (
            panel.top_strengths.map((strength, i) => (
              <StoryCard key={i} element={strength} light={light} />
            ))
          )}
        </div>

        {/* Covenants */}
        <div className="space-y-2">
          <h4 className={`text-xs font-semibold uppercase ${light ? "text-blue-600" : "text-blue-400"}`}>Suggested Covenants</h4>
          {panel.covenant_suggestions.length === 0 ? (
            <p className={`text-xs ${light ? "text-gray-400" : "text-zinc-500"}`}>No covenants suggested</p>
          ) : (
            panel.covenant_suggestions.map((cov, i) => (
              <CovenantCard key={i} covenant={cov} light={light} />
            ))
          )}
        </div>
      </div>

      {/* Resolution narrative */}
      {panel.resolution_narrative && (
        <div className={`rounded-lg border p-3 ${light ? "border-gray-200 bg-gray-50" : "border-zinc-700 bg-zinc-800/30"}`}>
          <h4 className={`text-xs font-semibold uppercase ${light ? "text-gray-500" : "text-zinc-400"}`}>Resolution Path</h4>
          <p className={`mt-1 text-sm ${light ? "text-gray-700" : "text-zinc-300"}`}>{panel.resolution_narrative}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StoryCard({ element, light = false }: { element: StoryElement; light?: boolean }) {
  const styles = light ? SEVERITY_STYLES_LIGHT : SEVERITY_STYLES_DARK;
  const style = element.severity ? styles[element.severity] : null;
  const defaultBg = light ? "border-gray-200 bg-gray-50" : "border-zinc-700 bg-zinc-800/30";
  const defaultText = light ? "text-gray-800" : "text-zinc-200";

  return (
    <div className={`rounded border p-2.5 ${style ? style.bg : defaultBg}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`text-xs font-semibold ${style ? style.text : defaultText}`}>
          {element.title}
        </span>
        {element.severity && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${style?.text ?? ""}`}>
            {element.severity}
          </span>
        )}
      </div>
      <p className={`mt-1 text-xs ${light ? "text-gray-500" : "text-zinc-400"}`}>{element.narrative}</p>
    </div>
  );
}

function CovenantCard({ covenant, light = false }: { covenant: CovenantSuggestion; light?: boolean }) {
  return (
    <div className={`rounded border p-2.5 ${light ? "border-blue-200 bg-blue-50" : "border-blue-800/50 bg-blue-900/10"}`}>
      <span className={`text-xs font-semibold ${light ? "text-blue-700" : "text-blue-300"}`}>{covenant.covenant_type}</span>
      <p className={`mt-0.5 text-xs ${light ? "text-gray-500" : "text-zinc-400"}`}>{covenant.description}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${light ? "bg-blue-100 text-blue-600" : "bg-blue-900/30 text-blue-400"}`}>
          {FREQ_LABELS[covenant.frequency] ?? covenant.frequency}
        </span>
      </div>
    </div>
  );
}
