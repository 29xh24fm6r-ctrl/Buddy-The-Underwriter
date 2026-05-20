"use client";

import { cn } from "@/lib/cn";
import type {
  SubmissionOrchestrationViewModel,
  SubmissionOrchestrationState,
} from "@/lib/banker/buildSubmissionOrchestrationViewModel";
import { SUBMISSION_ORCHESTRATION_STATE_LABELS } from "@/lib/banker/buildSubmissionOrchestrationViewModel";

const STATE_STYLES: Record<
  SubmissionOrchestrationState,
  { border: string; dot: string; badgeBg: string; badgeText: string; glyph: string }
> = {
  not_started: {
    border: "border-white/10",
    dot: "bg-stone-400",
    badgeBg: "bg-white/10",
    badgeText: "text-white/70",
    glyph: "◌",
  },
  preparing_package: {
    border: "border-sky-400/30",
    dot: "bg-sky-400",
    badgeBg: "bg-sky-500/15",
    badgeText: "text-sky-200",
    glyph: "●",
  },
  awaiting_clarifications: {
    border: "border-amber-400/30",
    dot: "bg-amber-400",
    badgeBg: "bg-amber-500/15",
    badgeText: "text-amber-200",
    glyph: "…",
  },
  package_review: {
    border: "border-sky-400/30",
    dot: "bg-sky-400",
    badgeBg: "bg-sky-500/15",
    badgeText: "text-sky-200",
    glyph: "▲",
  },
  ready_for_submission: {
    border: "border-emerald-400/40",
    dot: "bg-emerald-400",
    badgeBg: "bg-emerald-500/15",
    badgeText: "text-emerald-200",
    glyph: "★",
  },
  submission_in_progress: {
    border: "border-emerald-400/30",
    dot: "bg-emerald-400",
    badgeBg: "bg-emerald-500/15",
    badgeText: "text-emerald-200",
    glyph: "→",
  },
  submitted: {
    border: "border-emerald-500/40",
    dot: "bg-emerald-500",
    badgeBg: "bg-emerald-500/20",
    badgeText: "text-emerald-200",
    glyph: "✓",
  },
};

export function SubmissionOrchestrationHero({
  viewModel,
}: {
  viewModel: SubmissionOrchestrationViewModel;
}) {
  const style = STATE_STYLES[viewModel.state];
  const stateLabel = SUBMISSION_ORCHESTRATION_STATE_LABELS[viewModel.state];

  return (
    <section
      role="region"
      aria-label="Submission orchestration overview"
      className={cn(
        "overflow-hidden rounded-2xl border bg-white/[0.03] p-5 sm:p-6",
        style.border,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", style.dot)} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
          Submission orchestration
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            style.badgeBg,
            style.badgeText,
          )}
          aria-label={stateLabel}
        >
          <span aria-hidden="true" className="text-[9px] leading-none">
            {style.glyph}
          </span>
          {stateLabel}
        </span>
      </div>

      <h2 className="mt-3 font-serif text-xl leading-tight text-white sm:text-2xl">
        {viewModel.headline}
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-white/70">
        {viewModel.summary}
      </p>
    </section>
  );
}
