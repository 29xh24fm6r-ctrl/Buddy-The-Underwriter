"use client";

import type { StoryPanel, StoryElement, CovenantSuggestion } from "@/lib/spreadOutput/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: "bg-red-900/30 border-red-700", text: "text-red-300" },
  elevated: { bg: "bg-amber-900/30 border-amber-700", text: "text-amber-300" },
  watch: { bg: "bg-yellow-900/30 border-yellow-700", text: "text-yellow-300" },
};

const FREQ_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StoryPanelView({ panel }: { panel: StoryPanel }) {
  return (
    <div className="space-y-4">
      {/* Final narrative */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
        <h4 className="text-xs font-semibold uppercase text-zinc-400">Credit Narrative</h4>
        <p className="mt-2 text-sm leading-relaxed text-zinc-200">{panel.final_narrative}</p>
      </div>

      {/* 3-column: Risks / Strengths / Covenants */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* Risks */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-red-400">Top Risks</h4>
          {panel.top_risks.length === 0 ? (
            <p className="text-xs text-zinc-500">No material risks identified</p>
          ) : (
            panel.top_risks.map((risk, i) => (
              <StoryCard key={i} element={risk} />
            ))
          )}
        </div>

        {/* Strengths */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-green-400">Key Strengths</h4>
          {panel.top_strengths.length === 0 ? (
            <p className="text-xs text-zinc-500">No notable strengths identified</p>
          ) : (
            panel.top_strengths.map((strength, i) => (
              <StoryCard key={i} element={strength} />
            ))
          )}
        </div>

        {/* Covenants */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-blue-400">Suggested Covenants</h4>
          {panel.covenant_suggestions.length === 0 ? (
            <p className="text-xs text-zinc-500">No covenants suggested</p>
          ) : (
            panel.covenant_suggestions.map((cov, i) => (
              <CovenantCard key={i} covenant={cov} />
            ))
          )}
        </div>
      </div>

      {/* Resolution narrative */}
      {panel.resolution_narrative && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 p-3">
          <h4 className="text-xs font-semibold uppercase text-zinc-400">Resolution Path</h4>
          <p className="mt-1 text-sm text-zinc-300">{panel.resolution_narrative}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StoryCard({ element }: { element: StoryElement }) {
  const style = element.severity ? SEVERITY_STYLES[element.severity] : null;

  return (
    <div className={`rounded border p-2.5 ${style ? style.bg : "border-zinc-700 bg-zinc-800/30"}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`text-xs font-semibold ${style ? style.text : "text-zinc-200"}`}>
          {element.title}
        </span>
        {element.severity && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${style?.text ?? ""}`}>
            {element.severity}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-400">{element.narrative}</p>
    </div>
  );
}

function CovenantCard({ covenant }: { covenant: CovenantSuggestion }) {
  return (
    <div className="rounded border border-blue-800/50 bg-blue-900/10 p-2.5">
      <span className="text-xs font-semibold text-blue-300">{covenant.covenant_type}</span>
      <p className="mt-0.5 text-xs text-zinc-400">{covenant.description}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className="rounded bg-blue-900/30 px-1.5 py-0.5 text-[10px] text-blue-400">
          {FREQ_LABELS[covenant.frequency] ?? covenant.frequency}
        </span>
      </div>
    </div>
  );
}
