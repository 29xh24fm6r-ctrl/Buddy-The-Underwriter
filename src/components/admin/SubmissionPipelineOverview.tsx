"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  SubmissionPipelineStateSummary,
  SubmissionPipelineStateId,
} from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";
import { BROKERAGE_PIPELINE_STATE_LABELS } from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";

const STATE_TONE: Record<
  SubmissionPipelineStateId,
  { ring: string; valueColor: string }
> = {
  preparing_package: { ring: "ring-sky-400/30", valueColor: "text-sky-200" },
  awaiting_clarifications: { ring: "ring-amber-400/30", valueColor: "text-amber-200" },
  ready_for_submission: { ring: "ring-emerald-400/30", valueColor: "text-emerald-200" },
  submission_in_progress: { ring: "ring-emerald-400/40", valueColor: "text-emerald-200" },
  submitted: { ring: "ring-emerald-500/40", valueColor: "text-emerald-200" },
};

export function SubmissionPipelineOverview({
  pipeline,
}: {
  pipeline: SubmissionPipelineStateSummary[];
}) {
  return (
    <section
      role="region"
      aria-label="Submission pipeline overview"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="rocket_launch" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Submission pipeline</h3>
      </header>

      <dl
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5"
        aria-label="Submission pipeline state counts"
      >
        {pipeline.map((entry) => {
          const tone = STATE_TONE[entry.state];
          const label = BROKERAGE_PIPELINE_STATE_LABELS[entry.state];
          return (
            <div
              key={entry.state}
              className={cn(
                "rounded-xl border border-white/10 bg-white/[0.04] p-3 ring-1",
                tone.ring,
              )}
              aria-label={`${label}: ${entry.count}`}
            >
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
                {label}
              </dt>
              <dd className={cn("mt-1 text-2xl font-semibold", tone.valueColor)}>
                {entry.count}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
