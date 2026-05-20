"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BrokerageBottleneck,
  BrokerageBottleneckSeverity,
} from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";
import { BROKERAGE_BOTTLENECK_SEVERITY_LABELS } from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";

const SEVERITY_STYLES: Record<
  BrokerageBottleneckSeverity,
  { dot: string; pillBg: string; pillText: string; glyph: string }
> = {
  critical: {
    dot: "bg-rose-400",
    pillBg: "bg-rose-500/15 ring-1 ring-rose-400/30",
    pillText: "text-rose-200",
    glyph: "★",
  },
  elevated: {
    dot: "bg-amber-400",
    pillBg: "bg-amber-500/15 ring-1 ring-amber-400/30",
    pillText: "text-amber-200",
    glyph: "▲",
  },
  moderate: {
    dot: "bg-sky-400",
    pillBg: "bg-sky-500/15 ring-1 ring-sky-400/30",
    pillText: "text-sky-200",
    glyph: "●",
  },
  low: {
    dot: "bg-stone-400",
    pillBg: "bg-white/10 ring-1 ring-white/15",
    pillText: "text-stone-300",
    glyph: "◌",
  },
};

export function BrokerageBottlenecksPanel({
  bottlenecks,
}: {
  bottlenecks: BrokerageBottleneck[];
}) {
  return (
    <section
      role="region"
      aria-label="Operational bottlenecks"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="error" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Operational bottlenecks</h3>
        <span className="ml-auto inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">
          {bottlenecks.length}
        </span>
      </header>

      {bottlenecks.length === 0 ? (
        <p className="mt-3 text-sm italic text-white/60">
          No operational bottlenecks surfaced from current state.
        </p>
      ) : (
        <ul
          className="mt-4 space-y-2"
          role="list"
          aria-label="Bottlenecks list"
        >
          {bottlenecks.map((b) => {
            const style = SEVERITY_STYLES[b.severity];
            const severityLabel = BROKERAGE_BOTTLENECK_SEVERITY_LABELS[b.severity];
            return (
              <li
                key={b.id}
                className="rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 rounded-full", style.dot)}
                  />
                  <span className="text-sm font-semibold text-white">{b.label}</span>
                  <span
                    className={cn(
                      "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      style.pillBg,
                      style.pillText,
                    )}
                    aria-label={`Severity: ${severityLabel}`}
                  >
                    <span aria-hidden="true" className="text-[9px] leading-none">
                      {style.glyph}
                    </span>
                    {severityLabel}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-white/70">{b.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
                  <span aria-label={`Affected deals: ${b.affectedDeals}`}>
                    Affects {b.affectedDeals} deal{b.affectedDeals === 1 ? "" : "s"}
                  </span>
                  {b.href && (
                    <a
                      href={b.href}
                      aria-label={`Open ${b.label}`}
                      className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
                    >
                      Open
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
