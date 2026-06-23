"use client";

import { cn } from "@/lib/cn";
import type { BankerCommandCenterPriorityBand } from "@/lib/banker/buildBankerCommandCenterViewModel";
import { BANKER_COMMAND_CENTER_PRIORITY_LABELS } from "@/lib/banker/buildBankerCommandCenterViewModel";

const BAND_STYLES: Record<
  BankerCommandCenterPriorityBand,
  { dot: string; pillBg: string; pillText: string; ariaSymbol: string }
> = {
  immediate_attention: {
    dot: "bg-rose-400",
    pillBg: "bg-rose-500/15 ring-1 ring-rose-400/40",
    pillText: "text-rose-200",
    ariaSymbol: "★", // non-color-only indicator
  },
  active_review: {
    dot: "bg-amber-400",
    pillBg: "bg-amber-500/15 ring-1 ring-amber-400/40",
    pillText: "text-amber-200",
    ariaSymbol: "▲",
  },
  progressing: {
    dot: "bg-sky-400",
    pillBg: "bg-sky-500/15 ring-1 ring-sky-400/40",
    pillText: "text-sky-200",
    ariaSymbol: "●",
  },
  waiting_on_borrower: {
    dot: "bg-stone-400",
    pillBg: "bg-stone-500/15 ring-1 ring-stone-400/30",
    pillText: "text-stone-200",
    ariaSymbol: "◷",
  },
  monitoring: {
    dot: "bg-stone-500",
    pillBg: "bg-white/5 ring-1 ring-white/10",
    pillText: "text-stone-300",
    ariaSymbol: "◌",
  },
};

export function BankerPriorityBadge({
  band,
  className,
}: {
  band: BankerCommandCenterPriorityBand;
  className?: string;
}) {
  const style = BAND_STYLES[band];
  const label = BANKER_COMMAND_CENTER_PRIORITY_LABELS[band];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        style.pillBg,
        style.pillText,
        className,
      )}
      role="status"
      aria-label={`Priority: ${label}`}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      <span aria-hidden="true" className="text-[9px] leading-none">
        {style.ariaSymbol}
      </span>
      {label}
    </span>
  );
}
