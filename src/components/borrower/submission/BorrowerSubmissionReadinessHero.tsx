"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BorrowerSubmissionReadinessViewModel,
  BorrowerSubmissionReadinessBand,
} from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";

const BAND_STYLES: Record<
  BorrowerSubmissionReadinessBand,
  { border: string; bg: string; dot: string; badge: string; badgeBg: string }
> = {
  early_preparation: {
    border: "border-stone-200",
    bg: "bg-stone-50/60",
    dot: "bg-stone-400",
    badge: "text-stone-800",
    badgeBg: "bg-stone-100",
  },
  progressing: {
    border: "border-amber-200/70",
    bg: "bg-amber-50/30",
    dot: "bg-amber-500",
    badge: "text-amber-900",
    badgeBg: "bg-amber-100",
  },
  near_submission_preparation: {
    border: "border-sky-200/70",
    bg: "bg-sky-50/30",
    dot: "bg-sky-500",
    badge: "text-sky-900",
    badgeBg: "bg-sky-100",
  },
  submission_preparation_ready: {
    border: "border-emerald-200/70",
    bg: "bg-emerald-50/40",
    dot: "bg-emerald-500",
    badge: "text-emerald-900",
    badgeBg: "bg-emerald-100",
  },
};

export function BorrowerSubmissionReadinessHero({
  viewModel,
}: {
  viewModel: BorrowerSubmissionReadinessViewModel;
}) {
  const style = BAND_STYLES[viewModel.band];
  const pct = viewModel.readinessPercent;

  return (
    <section
      role="region"
      aria-label="Submission readiness"
      className={cn(
        "overflow-hidden rounded-[1.75rem] border p-5 shadow-sm sm:p-7",
        style.border,
        style.bg,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn("h-2 w-2 rounded-full", style.dot)}
          aria-hidden="true"
        />
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-600">
          Submission readiness
        </span>
        <span
          className={cn(
            "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            style.badgeBg,
            style.badge,
          )}
        >
          {viewModel.bandLabel}
        </span>
      </div>

      <h2 className="mt-4 font-serif text-2xl leading-tight text-stone-950 sm:text-3xl">
        {viewModel.headline}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-700 sm:text-base">
        {viewModel.summary}
      </p>

      {pct !== undefined && (
        <div className="mt-5">
          <div
            className="h-2.5 overflow-hidden rounded-full bg-stone-200/60"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-stone-600">
            <span>Required items received</span>
            <span className="font-semibold text-stone-900">{pct}%</span>
          </div>
        </div>
      )}
    </section>
  );
}
