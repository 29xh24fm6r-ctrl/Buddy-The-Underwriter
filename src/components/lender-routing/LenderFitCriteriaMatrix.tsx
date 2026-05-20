"use client";

import { cn } from "@/lib/cn";
import type {
  LenderFitCriterion,
  LenderFitCriterionStatus,
} from "@/lib/banker/buildLenderRoutingFitViewModel";
import { LENDER_FIT_CRITERION_STATUS_LABELS } from "@/lib/banker/buildLenderRoutingFitViewModel";

const STATUS_STYLES: Record<
  LenderFitCriterionStatus,
  { dot: string; pillBg: string; pillText: string; glyph: string }
> = {
  match: {
    dot: "bg-emerald-400",
    pillBg: "bg-emerald-500/15 ring-1 ring-emerald-400/30",
    pillText: "text-emerald-200",
    glyph: "✓",
  },
  possible_match: {
    dot: "bg-sky-400",
    pillBg: "bg-sky-500/15 ring-1 ring-sky-400/30",
    pillText: "text-sky-200",
    glyph: "≈",
  },
  mismatch: {
    dot: "bg-rose-400",
    pillBg: "bg-rose-500/15 ring-1 ring-rose-400/30",
    pillText: "text-rose-200",
    glyph: "✕",
  },
  missing_deal_data: {
    dot: "bg-amber-400",
    pillBg: "bg-amber-500/15 ring-1 ring-amber-400/30",
    pillText: "text-amber-200",
    glyph: "?",
  },
  missing_lender_data: {
    dot: "bg-stone-400",
    pillBg: "bg-white/10 ring-1 ring-white/15",
    pillText: "text-stone-300",
    glyph: "—",
  },
  not_applicable: {
    dot: "bg-stone-500",
    pillBg: "bg-white/5 ring-1 ring-white/10",
    pillText: "text-stone-400",
    glyph: "◌",
  },
};

export function LenderFitCriteriaMatrix({
  criteria,
}: {
  criteria: LenderFitCriterion[];
}) {
  if (criteria.length === 0) return null;

  return (
    <ul
      className="space-y-2"
      role="list"
      aria-label="Operational fit criteria"
    >
      {criteria.map((c) => {
        const style = STATUS_STYLES[c.status];
        const label = LENDER_FIT_CRITERION_STATUS_LABELS[c.status];
        return (
          <li
            key={c.id}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden="true"
                className={cn("h-1.5 w-1.5 rounded-full", style.dot)}
              />
              <span className="text-xs font-semibold text-white">{c.label}</span>
              <span
                className={cn(
                  "ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  style.pillBg,
                  style.pillText,
                )}
                aria-label={`Status: ${label}`}
              >
                <span aria-hidden="true" className="text-[8px] leading-none">
                  {style.glyph}
                </span>
                {label}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-1 gap-1 text-[11px] text-white/70 sm:grid-cols-2">
              <div>
                <span className="text-white/40">Deal: </span>
                <span>{c.dealValue ?? "—"}</span>
              </div>
              <div>
                <span className="text-white/40">Lender: </span>
                <span>{c.lenderValue ?? "—"}</span>
              </div>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-white/60">
              {c.explanation}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
