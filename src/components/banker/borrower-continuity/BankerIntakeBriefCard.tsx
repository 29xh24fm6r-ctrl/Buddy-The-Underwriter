"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BorrowerOperationalContinuityViewModel,
  BorrowerOperationalHandoffState,
} from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
import { BORROWER_OPERATIONAL_HANDOFF_STATE_LABELS } from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";

const STATE_STYLES: Record<
  BorrowerOperationalHandoffState,
  { border: string; bg: string; dot: string; badge: string; badgeBg: string }
> = {
  borrower_starting: {
    border: "border-stone-200",
    bg: "bg-stone-50/60",
    dot: "bg-stone-400",
    badge: "text-stone-800",
    badgeBg: "bg-stone-100",
  },
  borrower_active: {
    border: "border-sky-200/70",
    bg: "bg-sky-50/30",
    dot: "bg-sky-500",
    badge: "text-sky-900",
    badgeBg: "bg-sky-100",
  },
  borrower_blocked: {
    border: "border-rose-300/70",
    bg: "bg-rose-50/40",
    dot: "bg-rose-500",
    badge: "text-rose-900",
    badgeBg: "bg-rose-100",
  },
  waiting_on_borrower: {
    border: "border-amber-200/70",
    bg: "bg-amber-50/40",
    dot: "bg-amber-500",
    badge: "text-amber-900",
    badgeBg: "bg-amber-100",
  },
  waiting_on_banker: {
    border: "border-sky-200/70",
    bg: "bg-sky-50/40",
    dot: "bg-sky-500",
    badge: "text-sky-900",
    badgeBg: "bg-sky-100",
  },
  ready_for_banker_review: {
    border: "border-emerald-200/70",
    bg: "bg-emerald-50/40",
    dot: "bg-emerald-500",
    badge: "text-emerald-900",
    badgeBg: "bg-emerald-100",
  },
  ready_for_submission_prep: {
    border: "border-emerald-300/70",
    bg: "bg-emerald-50/60",
    dot: "bg-emerald-600",
    badge: "text-emerald-900",
    badgeBg: "bg-emerald-100",
  },
  needs_clarification: {
    border: "border-amber-300/70",
    bg: "bg-amber-50/60",
    dot: "bg-amber-500",
    badge: "text-amber-900",
    badgeBg: "bg-amber-100",
  },
};

export function BankerIntakeBriefCard({
  viewModel,
}: {
  viewModel: BorrowerOperationalContinuityViewModel;
}) {
  const style = STATE_STYLES[viewModel.handoffState];
  const stateLabel =
    BORROWER_OPERATIONAL_HANDOFF_STATE_LABELS[viewModel.handoffState];

  return (
    <section
      role="region"
      aria-label="Borrower intake brief"
      className={cn(
        "overflow-hidden rounded-[1.5rem] border p-5 shadow-sm sm:p-6",
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
          Borrower intake brief
        </span>
        <span
          className={cn(
            "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            style.badgeBg,
            style.badge,
          )}
          aria-label={stateLabel}
        >
          {stateLabel}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-0.5 text-[11px] font-semibold text-stone-700">
          <Icon name="pending" className="h-3 w-3 text-current" />
          {viewModel.waitingOnLabel}
        </span>
      </div>

      <h2 className="mt-3 font-serif text-xl leading-tight text-stone-950 sm:text-2xl">
        {viewModel.headline}
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-700">
        {viewModel.summary}
      </p>
    </section>
  );
}
