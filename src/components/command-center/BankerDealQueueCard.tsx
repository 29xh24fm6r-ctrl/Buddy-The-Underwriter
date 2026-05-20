"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BankerCommandCenterQueueItem } from "@/lib/banker/buildBankerCommandCenterViewModel";
import { BankerPriorityBadge } from "@/components/command-center/BankerPriorityBadge";
import { BankerOperationalStalenessPill } from "@/components/command-center/BankerOperationalStalenessPill";

export function BankerDealQueueCard({
  item,
}: {
  item: BankerCommandCenterQueueItem;
}) {
  return (
    <article
      className={cn(
        "rounded-2xl border border-white/10 bg-white/5 p-4 transition",
        "hover:border-white/20 hover:bg-white/[0.07]",
      )}
      aria-label={`Deal ${item.borrowerLabel}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-white">
          {item.borrowerLabel}
        </h3>
        <BankerPriorityBadge band={item.priorityBand} className="ml-auto" />
      </header>

      <ul
        className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"
        role="list"
        aria-label="Deal operational signals"
      >
        <KeyValue label="Waiting on" value={item.waitingOnLabel} />
        <KeyValue label="Submission" value={item.readinessLabel} />
        <KeyValue
          label="Trust review"
          value={item.trustReviewLabel ?? "Not ready for review yet"}
        />
        {typeof item.requiredDocumentsRemaining === "number" && (
          <KeyValue
            label="Docs remaining"
            value={String(item.requiredDocumentsRemaining)}
          />
        )}
        {typeof item.needsAttentionCount === "number" && (
          <KeyValue
            label="Flagged"
            value={String(item.needsAttentionCount)}
          />
        )}
        {item.staleness && (
          <li className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Activity
            </div>
            <div className="mt-1">
              <BankerOperationalStalenessPill
                staleness={item.staleness}
                daysSinceLastActivity={item.daysSinceLastActivity}
              />
            </div>
          </li>
        )}
      </ul>

      {item.topBlocker && (
        <p
          className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
          aria-label="Top blocker"
        >
          <span className="font-semibold">Top blocker: </span>
          {item.topBlocker}
        </p>
      )}

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
          Next best action
        </div>
        <p className="mt-1 text-sm text-white">{item.nextBestActionLabel}</p>
      </div>

      {item.recentActivitySummary && (
        <p className="mt-3 text-xs text-white/60" aria-label="Recent activity">
          {item.recentActivitySummary}
        </p>
      )}

      {item.href && (
        <div className="mt-3">
          <a
            href={item.href}
            aria-label={`Open deal ${item.borrowerLabel}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-stone-900 transition hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
          >
            <Icon name="arrow_forward_ios" className="h-3 w-3 text-current" />
            Open
          </a>
        </div>
      )}
    </article>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-white">{value}</div>
    </li>
  );
}
