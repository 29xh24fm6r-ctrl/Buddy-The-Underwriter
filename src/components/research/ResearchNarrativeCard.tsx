"use client";

/**
 * ResearchNarrativeCard
 *
 * Displays the compiled research narrative with inline citations.
 * Citations are clickable chips that expand to show source details.
 */

import { useState } from "react";
import type {
  NarrativeSection,
  NarrativeSentence,
  Citation,
  ResearchFact,
  ResearchInference,
} from "@/lib/research/types";

// Source summary for citation tooltips
type SourceSummary = {
  id: string;
  source_class: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
};

type ResearchNarrativeCardProps = {
  sections: NarrativeSection[];
  facts: ResearchFact[];
  inferences: ResearchInference[];
  sources: SourceSummary[];
  missionStatus?: "queued" | "running" | "complete" | "failed" | "cancelled";
  onStartMission?: () => void;
  isLoading?: boolean;
};

/**
 * Citation chip component with tooltip.
 */
function CitationChip({
  citation,
  facts,
  inferences,
  sources,
}: {
  citation: Citation;
  facts: ResearchFact[];
  inferences: ResearchInference[];
  sources: SourceSummary[];
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  // Get citation details
  let tooltipContent: string;
  let chipLabel: string;

  if (citation.type === "fact") {
    const fact = facts.find((f) => f.id === citation.id);
    if (fact) {
      const source = sources.find((s) => s.id === fact.source_id);
      chipLabel = `F${facts.indexOf(fact) + 1}`;
      tooltipContent = `${fact.fact_type}: ${JSON.stringify(fact.value)}\nSource: ${source?.source_name ?? "Unknown"}`;
    } else {
      chipLabel = "?";
      tooltipContent = "Citation not found";
    }
  } else {
    const inference = inferences.find((i) => i.id === citation.id);
    if (inference) {
      chipLabel = `I${inferences.indexOf(inference) + 1}`;
      tooltipContent = `${inference.inference_type}: ${inference.reasoning ?? inference.conclusion}`;
    } else {
      chipLabel = "?";
      tooltipContent = "Citation not found";
    }
  }

  return (
    <span className="relative inline-block">
      <button
        className={`
          ml-0.5 px-1.5 py-0.5 text-xs rounded-full font-mono
          ${citation.type === "fact"
            ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
            : "bg-amber-100 text-amber-700 hover:bg-amber-200"
          }
          transition-colors cursor-help
        `}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={() => setShowTooltip(!showTooltip)}
      >
        {chipLabel}
      </button>
      {showTooltip && (
        <div className="absolute bottom-full left-0 mb-1 z-50 w-64 p-2 text-xs bg-slate-800 text-white rounded shadow-lg whitespace-pre-wrap">
          {tooltipContent}
        </div>
      )}
    </span>
  );
}

/**
 * Sentence component with inline citations.
 */
function SentenceWithCitations({
  sentence,
  facts,
  inferences,
  sources,
}: {
  sentence: NarrativeSentence;
  facts: ResearchFact[];
  inferences: ResearchInference[];
  sources: SourceSummary[];
}) {
  return (
    <span>
      {sentence.text}
      {sentence.citations.length > 0 && (
        <span className="inline-flex gap-0.5 ml-1">
          {sentence.citations.map((citation, idx) => (
            <CitationChip
              key={`${citation.type}-${citation.id}-${idx}`}
              citation={citation}
              facts={facts}
              inferences={inferences}
              sources={sources}
            />
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * Section component.
 */
function NarrativeSectionDisplay({
  section,
  facts,
  inferences,
  sources,
}: {
  section: NarrativeSection;
  facts: ResearchFact[];
  inferences: ResearchInference[];
  sources: SourceSummary[];
}) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-slate-800 mb-3">{section.title}</h3>
      <div className="text-slate-700 leading-relaxed space-y-2">
        {section.sentences.map((sentence, idx) => (
          <p key={idx}>
            <SentenceWithCitations
              sentence={sentence}
              facts={facts}
              inferences={inferences}
              sources={sources}
            />
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * Loading skeleton.
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 bg-slate-200 rounded w-1/3"></div>
      <div className="space-y-2">
        <div className="h-4 bg-slate-200 rounded w-full"></div>
        <div className="h-4 bg-slate-200 rounded w-5/6"></div>
        <div className="h-4 bg-slate-200 rounded w-4/6"></div>
      </div>
      <div className="h-6 bg-slate-200 rounded w-1/4 mt-6"></div>
      <div className="space-y-2">
        <div className="h-4 bg-slate-200 rounded w-full"></div>
        <div className="h-4 bg-slate-200 rounded w-3/4"></div>
      </div>
    </div>
  );
}

/**
 * Empty state when no research exists.
 */
function EmptyState({ onStartMission }: { onStartMission?: () => void }) {
  return (
    <div className="text-center py-8">
      <div className="text-4xl mb-4">📊</div>
      <h3 className="text-lg font-semibold text-slate-700 mb-2">
        No Industry Research Yet
      </h3>
      <p className="text-slate-500 mb-4">
        Buddy can research the industry landscape, competitive environment, and market dynamics for this deal.
      </p>
      {onStartMission && (
        <button
          onClick={onStartMission}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Start Industry Research
        </button>
      )}
    </div>
  );
}

/**
 * Running state.
 */
function RunningState() {
  return (
    <div className="text-center py-8">
      <div className="text-4xl mb-4 animate-bounce">🔍</div>
      <h3 className="text-lg font-semibold text-slate-700 mb-2">
        Researching...
      </h3>
      <p className="text-slate-500">
        Buddy is gathering data from government and regulatory sources.
      </p>
    </div>
  );
}

/**
 * Error state.
 */
function ErrorState({ message }: { message?: string }) {
  return (
    <div className="text-center py-8">
      <div className="text-4xl mb-4">⚠️</div>
      <h3 className="text-lg font-semibold text-slate-700 mb-2">
        Research Failed
      </h3>
      <p className="text-slate-500">
        {message ?? "An error occurred during research. Please try again."}
      </p>
    </div>
  );
}

/**
 * Main component.
 */
export default function ResearchNarrativeCard({
  sections,
  facts,
  inferences,
  sources,
  missionStatus,
  onStartMission,
  isLoading,
}: ResearchNarrativeCardProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span>🔬</span>
          <span>Industry Research</span>
        </h2>
        <LoadingSkeleton />
      </div>
    );
  }

  // Running state
  if (missionStatus === "running" || missionStatus === "queued") {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span>🔬</span>
          <span>Industry Research</span>
        </h2>
        <RunningState />
      </div>
    );
  }

  // Error state
  if (missionStatus === "failed") {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span>🔬</span>
          <span>Industry Research</span>
        </h2>
        <ErrorState />
      </div>
    );
  }

  // Empty state
  if (!sections || sections.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span>🔬</span>
          <span>Industry Research</span>
        </h2>
        <EmptyState onStartMission={onStartMission} />
      </div>
    );
  }

  // Full narrative display
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <span>🔬</span>
          <span>Industry Research</span>
        </h2>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-mono text-xs">
            {facts.length} facts
          </span>
          <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full font-mono text-xs">
            {inferences.length} inferences
          </span>
          <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded-full font-mono text-xs">
            {sources.length} sources
          </span>
        </div>
      </div>

      <div className="prose prose-slate max-w-none">
        {sections.map((section, idx) => (
          <NarrativeSectionDisplay
            key={idx}
            section={section}
            facts={facts}
            inferences={inferences}
            sources={sources}
          />
        ))}
      </div>

      {/* Source attribution */}
      <div className="mt-6 pt-4 border-t border-slate-200">
        <details className="text-sm">
          <summary className="text-slate-500 cursor-pointer hover:text-slate-700">
            View data sources ({sources.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {sources.map((source) => (
              <li key={source.id} className="text-slate-600">
                <span className="font-medium">{source.source_name}</span>
                <span className="text-slate-400 ml-2">({source.source_class})</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
