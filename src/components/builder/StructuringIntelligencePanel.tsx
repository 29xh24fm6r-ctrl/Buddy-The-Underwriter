"use client";

import { useState } from "react";
import type { StructuringScenario, PathToApprovalPlan } from "@/lib/structuring/types";

type Props = {
  scenarios: StructuringScenario[];
  plan: PathToApprovalPlan | null;
  onPreview?: (scenario: StructuringScenario) => void;
  onApply?: (scenario: StructuringScenario) => void;
  onDismiss?: (scenario: StructuringScenario) => void;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

const BAND_STYLES: Record<string, { label: string; cls: string }> = {
  best: { label: "Best Path", cls: "bg-emerald-500/20 text-emerald-300" },
  strong: { label: "Strong", cls: "bg-blue-500/20 text-blue-300" },
  possible: { label: "Possible", cls: "bg-white/10 text-white/60" },
  exception_only: { label: "Exception Path", cls: "bg-amber-500/20 text-amber-300" },
};

const PATH_STYLES: Record<string, { label: string; cls: string }> = {
  inside_policy: { label: "Inside Policy", cls: "text-emerald-300" },
  ready_with_exceptions: { label: "Ready with Exceptions", cls: "text-amber-300" },
  not_yet_ready: { label: "Not Yet Ready", cls: "text-white/40" },
};

export function StructuringIntelligencePanel({ scenarios, plan, onPreview, onApply, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (scenarios.length === 0) return null;

  const best = scenarios[0];
  const alternatives = scenarios.slice(1);

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-white">Structuring Intelligence</div>

      {/* Best Path card */}
      {plan && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-600/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${BAND_STYLES[best.recommendation_band]?.cls ?? ""}`}>
                {BAND_STYLES[best.recommendation_band]?.label ?? best.recommendation_band}
              </span>
              <span className={`text-[10px] ${PATH_STYLES[best.path_type]?.cls ?? ""}`}>
                {PATH_STYLES[best.path_type]?.label ?? best.path_type}
              </span>
            </div>
            <span className="text-[10px] text-white/30">Score: {best.recommendation_score}</span>
          </div>

          <div className="text-sm font-medium text-white">{plan.headline}</div>
          <div className="text-xs text-white/70">{best.summary}</div>

          {/* Steps */}
          <div className="space-y-1">
            {plan.steps.map((step) => (
              <div key={step.step_number} className="flex gap-2 text-xs">
                <span className="text-emerald-400 font-semibold shrink-0">{step.step_number}.</span>
                <span className="text-white/70">{step.action}</span>
              </div>
            ))}
          </div>

          <div className="text-[10px] text-emerald-300/60 italic">{plan.projected_outcome}</div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            {onPreview && (
              <button type="button" onClick={() => onPreview(best)} className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">
                Preview Changes
              </button>
            )}
            {onApply && best.path_type !== "not_yet_ready" && (
              <button type="button" onClick={() => onApply(best)} className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-600/30">
                Apply to Builder
              </button>
            )}
            {onDismiss && (
              <button type="button" onClick={() => onDismiss(best)} className="text-xs text-white/40 hover:text-white/60 px-2">
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* Alternatives */}
      {alternatives.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-white/50 hover:text-white/80 mb-2"
          >
            {expanded ? "Hide" : "Show"} {alternatives.length} alternative{alternatives.length > 1 ? "s" : ""}
          </button>

          {expanded && (
            <div className="space-y-2">
              {alternatives.map((scenario) => {
                const band = BAND_STYLES[scenario.recommendation_band] ?? BAND_STYLES.possible;
                const path = PATH_STYLES[scenario.path_type] ?? PATH_STYLES.not_yet_ready;
                return (
                  <div key={scenario.id} className={`${glass} space-y-2`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${band.cls}`}>
                        {band.label}
                      </span>
                      <span className={`text-[10px] ${path.cls}`}>{path.label}</span>
                      <span className="text-[10px] text-white/30">Score: {scenario.recommendation_score}</span>
                    </div>
                    <div className="text-xs font-medium text-white">{scenario.label}</div>
                    <div className="text-[10px] text-white/60">{scenario.summary}</div>
                    {scenario.tradeoffs.length > 0 && (
                      <div className="text-[10px] text-white/40">Tradeoffs: {scenario.tradeoffs.join("; ")}</div>
                    )}
                    {onPreview && (
                      <button type="button" onClick={() => onPreview(scenario)} className="text-xs text-primary hover:underline">
                        Preview
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Rationale */}
      {best.assumptions.length > 0 && (
        <div className="text-[10px] text-white/30">
          Assumptions: {best.assumptions.join("; ")}
        </div>
      )}
    </div>
  );
}
