"use client";

import { cn } from "@/lib/cn";
import type { BankerCommandCenterStalenessLabel } from "@/lib/banker/buildBankerCommandCenterViewModel";
import { BANKER_COMMAND_CENTER_STALENESS_LABELS } from "@/lib/banker/buildBankerCommandCenterViewModel";

const STYLES: Record<
  BankerCommandCenterStalenessLabel,
  { pillBg: string; pillText: string; glyph: string }
> = {
  recently_active: {
    pillBg: "bg-emerald-500/15 ring-1 ring-emerald-400/30",
    pillText: "text-emerald-200",
    glyph: "↑",
  },
  waiting_for_follow_up: {
    pillBg: "bg-amber-500/15 ring-1 ring-amber-400/30",
    pillText: "text-amber-200",
    glyph: "…",
  },
  stalled: {
    pillBg: "bg-rose-500/15 ring-1 ring-rose-400/30",
    pillText: "text-rose-200",
    glyph: "—",
  },
  needs_review: {
    pillBg: "bg-sky-500/15 ring-1 ring-sky-400/30",
    pillText: "text-sky-200",
    glyph: "?",
  },
};

export function BankerOperationalStalenessPill({
  staleness,
  daysSinceLastActivity,
  className,
}: {
  staleness: BankerCommandCenterStalenessLabel;
  daysSinceLastActivity?: number;
  className?: string;
}) {
  const style = STYLES[staleness];
  const label = BANKER_COMMAND_CENTER_STALENESS_LABELS[staleness];
  const suffix =
    typeof daysSinceLastActivity === "number" && daysSinceLastActivity > 0
      ? ` · ${daysSinceLastActivity}d`
      : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        style.pillBg,
        style.pillText,
        className,
      )}
      role="status"
      aria-label={`Activity: ${label}${suffix ? `, ${daysSinceLastActivity} days since activity` : ""}`}
    >
      <span aria-hidden="true" className="text-[9px] leading-none">
        {style.glyph}
      </span>
      {label}
      {suffix}
    </span>
  );
}
