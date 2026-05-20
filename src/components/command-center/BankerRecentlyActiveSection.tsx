"use client";

import { Icon } from "@/components/ui/Icon";
import type { BankerCommandCenterQueueItem } from "@/lib/banker/buildBankerCommandCenterViewModel";
import { BankerOperationalStalenessPill } from "@/components/command-center/BankerOperationalStalenessPill";

export function BankerRecentlyActiveSection({
  items,
}: {
  items: BankerCommandCenterQueueItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section
      role="region"
      aria-label="Recently active deals"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="sync" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h2 className="text-sm font-semibold text-white">Recently active</h2>
        <span className="ml-auto inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">
          {items.length}
        </span>
      </header>

      <ul
        className="mt-3 space-y-2"
        role="list"
        aria-label="Recently active deals list"
      >
        {items.map((item) => (
          <li
            key={item.dealId}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
          >
            <span className="text-sm font-semibold text-white">{item.borrowerLabel}</span>
            <span className="text-xs text-white/60">·</span>
            <span className="text-xs text-white/70">{item.waitingOnLabel}</span>
            {item.staleness && (
              <span className="ml-auto">
                <BankerOperationalStalenessPill
                  staleness={item.staleness}
                  daysSinceLastActivity={item.daysSinceLastActivity}
                />
              </span>
            )}
            {item.href && (
              <a
                href={item.href}
                aria-label={`Open deal ${item.borrowerLabel}`}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
              >
                Open
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
