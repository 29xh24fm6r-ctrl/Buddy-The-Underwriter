"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  LenderRoutingOption,
  LenderRoutingOptionStatus,
} from "@/lib/banker/buildLenderRoutingFitViewModel";
import { LENDER_ROUTING_OPTION_STATUS_LABELS } from "@/lib/banker/buildLenderRoutingFitViewModel";
import { LenderFitCriteriaMatrix } from "@/components/lender-routing/LenderFitCriteriaMatrix";

const STATUS_STYLES: Record<
  LenderRoutingOptionStatus,
  { dot: string; pillBg: string; pillText: string; glyph: string }
> = {
  strong_operational_fit: {
    dot: "bg-emerald-400",
    pillBg: "bg-emerald-500/15 ring-1 ring-emerald-400/30",
    pillText: "text-emerald-200",
    glyph: "★",
  },
  possible_fit: {
    dot: "bg-sky-400",
    pillBg: "bg-sky-500/15 ring-1 ring-sky-400/30",
    pillText: "text-sky-200",
    glyph: "●",
  },
  needs_more_information: {
    dot: "bg-amber-400",
    pillBg: "bg-amber-500/15 ring-1 ring-amber-400/30",
    pillText: "text-amber-200",
    glyph: "?",
  },
  not_currently_compatible: {
    dot: "bg-rose-400",
    pillBg: "bg-rose-500/15 ring-1 ring-rose-400/30",
    pillText: "text-rose-200",
    glyph: "✕",
  },
  unavailable: {
    dot: "bg-stone-500",
    pillBg: "bg-white/5 ring-1 ring-white/10",
    pillText: "text-stone-400",
    glyph: "◌",
  },
};

export function LenderRoutingOptions({
  options,
}: {
  options: LenderRoutingOption[];
}) {
  if (options.length === 0) return null;

  return (
    <section
      role="region"
      aria-label="Lender routing options"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="handshake" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Routing options</h3>
        <span className="ml-auto inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">
          {options.length}
        </span>
      </header>

      <ul
        className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2"
        role="list"
        aria-label="Routing options list"
      >
        {options.map((opt) => {
          const style = STATUS_STYLES[opt.status];
          const statusLabel = LENDER_ROUTING_OPTION_STATUS_LABELS[opt.status];
          return (
            <li
              key={opt.id}
              className="rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:p-4"
              aria-label={`Routing option ${opt.label}`}
            >
              <header className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn("h-2 w-2 rounded-full", style.dot)}
                />
                <h4 className="text-sm font-semibold text-white">{opt.label}</h4>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider text-white/40"
                  aria-label={`Type ${opt.type === "channel" ? "channel" : "lender"}`}
                >
                  {opt.type === "channel" ? "Channel" : "Lender"}
                </span>
                <span
                  className={cn(
                    "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    style.pillBg,
                    style.pillText,
                  )}
                  aria-label={`Status: ${statusLabel}`}
                >
                  <span aria-hidden="true" className="text-[9px] leading-none">
                    {style.glyph}
                  </span>
                  {statusLabel}
                </span>
              </header>

              <p className="mt-2 text-xs leading-5 text-white/70">{opt.summary}</p>

              <div className="mt-3">
                <LenderFitCriteriaMatrix criteria={opt.criteria} />
              </div>

              {opt.missingInputs.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                    Missing for this option
                  </div>
                  <ul
                    className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-amber-100"
                    role="list"
                    aria-label="Missing inputs for option"
                  >
                    {opt.missingInputs.map((mi) => (
                      <li key={mi.id}>{mi.label}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Recommended action
                </div>
                <p className="mt-1 text-xs text-white">
                  {opt.recommendedActionLabel}
                </p>
              </div>

              {opt.href && (
                <div className="mt-3">
                  <a
                    href={opt.href}
                    aria-label={`Open routing option: ${opt.label}`}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
                  >
                    Open
                  </a>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
