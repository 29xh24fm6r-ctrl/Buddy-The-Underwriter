"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  ExecutiveAttentionItem,
  BrokerageBottleneckSeverity,
  ExecutiveAttentionArea,
} from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";
import { BROKERAGE_BOTTLENECK_SEVERITY_LABELS } from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";

const SEVERITY_STYLES: Record<
  BrokerageBottleneckSeverity,
  { pillBg: string; pillText: string; dot: string; glyph: string }
> = {
  critical: {
    pillBg: "bg-rose-500/15 ring-1 ring-rose-400/30",
    pillText: "text-rose-200",
    dot: "bg-rose-400",
    glyph: "★",
  },
  elevated: {
    pillBg: "bg-amber-500/15 ring-1 ring-amber-400/30",
    pillText: "text-amber-200",
    dot: "bg-amber-400",
    glyph: "▲",
  },
  moderate: {
    pillBg: "bg-sky-500/15 ring-1 ring-sky-400/30",
    pillText: "text-sky-200",
    dot: "bg-sky-400",
    glyph: "●",
  },
  low: {
    pillBg: "bg-white/10 ring-1 ring-white/15",
    pillText: "text-stone-300",
    dot: "bg-stone-400",
    glyph: "◌",
  },
};

const AREA_LABEL: Record<ExecutiveAttentionArea, string> = {
  submission: "Submission",
  routing: "Routing",
  borrower: "Borrower",
  banker: "Banker",
  operations: "Operations",
};

export function ExecutiveAttentionQueue({
  items,
}: {
  items: ExecutiveAttentionItem[];
}) {
  return (
    <section
      role="region"
      aria-label="Executive attention queue"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="auto_awesome" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Executive attention</h3>
        <span className="ml-auto inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">
          {items.length}
        </span>
      </header>

      {items.length === 0 ? (
        <p className="mt-3 text-sm italic text-white/60">
          No items require executive attention right now.
        </p>
      ) : (
        <ul
          className="mt-3 space-y-2"
          role="list"
          aria-label="Executive attention items"
        >
          {items.map((item) => {
            const style = SEVERITY_STYLES[item.severity];
            const severityLabel = BROKERAGE_BOTTLENECK_SEVERITY_LABELS[item.severity];
            return (
              <li
                key={item.id}
                className="rounded-xl border border-white/10 bg-white/[0.04] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 rounded-full", style.dot)}
                  />
                  <span className="text-sm font-semibold text-white">{item.label}</span>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider text-white/40"
                    aria-label={`Area ${AREA_LABEL[item.area]}`}
                  >
                    {AREA_LABEL[item.area]}
                  </span>
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
                <p className="mt-1 text-xs leading-5 text-white/70">{item.reason}</p>
                {item.href && (
                  <div className="mt-2">
                    <a
                      href={item.href}
                      aria-label={`Open ${item.label}`}
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
      )}
    </section>
  );
}
