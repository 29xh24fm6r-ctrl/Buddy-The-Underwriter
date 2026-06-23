"use client";

import { cn } from "@/lib/cn";
import type {
  LenderRoutingFitViewModel,
  LenderRoutingState,
} from "@/lib/banker/buildLenderRoutingFitViewModel";
import { LENDER_ROUTING_STATE_LABELS } from "@/lib/banker/buildLenderRoutingFitViewModel";

const STATE_STYLES: Record<
  LenderRoutingState,
  { border: string; dot: string; badgeBg: string; badgeText: string; glyph: string }
> = {
  not_ready: {
    border: "border-white/10",
    dot: "bg-stone-400",
    badgeBg: "bg-white/10",
    badgeText: "text-white/70",
    glyph: "◌",
  },
  gathering_fit_inputs: {
    border: "border-amber-400/30",
    dot: "bg-amber-400",
    badgeBg: "bg-amber-500/15",
    badgeText: "text-amber-200",
    glyph: "…",
  },
  ready_for_fit_review: {
    border: "border-sky-400/30",
    dot: "bg-sky-400",
    badgeBg: "bg-sky-500/15",
    badgeText: "text-sky-200",
    glyph: "▲",
  },
  fit_review_in_progress: {
    border: "border-sky-400/30",
    dot: "bg-sky-400",
    badgeBg: "bg-sky-500/15",
    badgeText: "text-sky-200",
    glyph: "→",
  },
  routing_options_available: {
    border: "border-emerald-400/40",
    dot: "bg-emerald-400",
    badgeBg: "bg-emerald-500/15",
    badgeText: "text-emerald-200",
    glyph: "★",
  },
  routing_review_complete: {
    border: "border-emerald-500/40",
    dot: "bg-emerald-500",
    badgeBg: "bg-emerald-500/20",
    badgeText: "text-emerald-200",
    glyph: "✓",
  },
};

export function LenderRoutingHero({
  viewModel,
}: {
  viewModel: LenderRoutingFitViewModel;
}) {
  const style = STATE_STYLES[viewModel.state];
  const stateLabel = LENDER_ROUTING_STATE_LABELS[viewModel.state];

  return (
    <section
      role="region"
      aria-label="Lender routing overview"
      className={cn(
        "overflow-hidden rounded-2xl border bg-white/[0.03] p-5 sm:p-6",
        style.border,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", style.dot)} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
          Lender routing intelligence
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
      <p className="mt-3 text-[11px] uppercase tracking-wider text-white/40">
        Operational compatibility view · not a credit or approval indicator
      </p>
    </section>
  );
}
