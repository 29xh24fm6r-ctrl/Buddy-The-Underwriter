"use client";

import type { StepCompletion, BuilderStepKey } from "@/lib/builder/builderTypes";

type Props = {
  steps: StepCompletion[];
  activeStep: BuilderStepKey;
  onStepClick: (key: BuilderStepKey) => void;
};

function StepIndicator({ step }: { step: StepCompletion }) {
  if (step.complete) return <span className="text-emerald-400">&#10003;</span>;
  if (step.blockers > 0) return <span className="text-rose-400">{step.blockers}</span>;
  if (step.warnings > 0) return <span className="text-amber-400">&#9888; {step.warnings}</span>;
  if (step.pct === 0) return <span className="text-white/30">&#9675;</span>;
  return <span className="text-white/50">{step.pct}%</span>;
}

export function BuilderWorkflowRail({ steps, activeStep, onStepClick }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
      {steps.map((step) => {
        const isActive = step.key === activeStep;
        return (
          <button
            key={step.key}
            type="button"
            onClick={() => onStepClick(step.key)}
            className={[
              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm whitespace-nowrap transition-colors",
              isActive
                ? "bg-white/10 text-white border-white/15"
                : "text-white/70 border-white/10 hover:text-white hover:bg-white/5",
            ].join(" ")}
          >
            <span className="text-[11px]">
              <StepIndicator step={step} />
            </span>
            {step.label}
          </button>
        );
      })}
    </div>
  );
}
