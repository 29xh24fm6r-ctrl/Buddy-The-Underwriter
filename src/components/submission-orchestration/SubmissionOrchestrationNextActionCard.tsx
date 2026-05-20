"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { SubmissionOrchestrationNextAction } from "@/lib/banker/buildSubmissionOrchestrationViewModel";

const URGENCY_STYLES: Record<
  SubmissionOrchestrationNextAction["urgency"],
  { pillBg: string; pillText: string; label: string }
> = {
  high: {
    pillBg: "bg-rose-500/15 ring-1 ring-rose-400/30",
    pillText: "text-rose-200",
    label: "High urgency",
  },
  normal: {
    pillBg: "bg-sky-500/15 ring-1 ring-sky-400/30",
    pillText: "text-sky-200",
    label: "Normal urgency",
  },
  low: {
    pillBg: "bg-white/10 ring-1 ring-white/15",
    pillText: "text-stone-300",
    label: "Low urgency",
  },
};

export function SubmissionOrchestrationNextActionCard({
  action,
}: {
  action: SubmissionOrchestrationNextAction;
}) {
  const style = URGENCY_STYLES[action.urgency];
  return (
    <section
      role="region"
      aria-label="Submission orchestration next action"
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="play_arrow" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Next orchestration action</h3>
        <span
          className={cn(
            "ml-auto inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            style.pillBg,
            style.pillText,
          )}
          aria-label={style.label}
        >
          {style.label}
        </span>
      </div>
      <div className="mt-3">
        <div className="text-base font-semibold text-white">{action.label}</div>
        <p className="mt-1 text-sm leading-6 text-white/70">{action.rationale}</p>
      </div>
      {action.href && (
        <div className="mt-4">
          <a
            href={action.href}
            aria-label={action.label}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-stone-900 transition hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
          >
            <Icon name="arrow_forward_ios" className="h-3 w-3 text-current" />
            Open
          </a>
        </div>
      )}
    </section>
  );
}
