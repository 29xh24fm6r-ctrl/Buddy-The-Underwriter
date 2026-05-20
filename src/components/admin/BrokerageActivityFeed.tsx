"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BrokerageActivityEvent,
  BrokerageActivityCategory,
} from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";

const CATEGORY_STYLES: Record<
  BrokerageActivityCategory,
  { dot: string; label: string }
> = {
  borrower: { dot: "bg-sky-400", label: "Borrower" },
  submission: { dot: "bg-emerald-400", label: "Submission" },
  routing: { dot: "bg-amber-400", label: "Routing" },
  clarification: { dot: "bg-amber-300", label: "Clarification" },
  operations: { dot: "bg-stone-400", label: "Operations" },
};

export function BrokerageActivityFeed({
  activity,
}: {
  activity: BrokerageActivityEvent[];
}) {
  return (
    <section
      role="region"
      aria-label="Brokerage activity feed"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="history" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Activity feed</h3>
      </header>

      {activity.length === 0 ? (
        <p className="mt-3 text-sm italic text-white/60">
          No recent operational activity recorded.
        </p>
      ) : (
        <ol
          className="mt-3 space-y-2"
          role="list"
          aria-label="Activity events"
        >
          {activity.map((event) => {
            const style = CATEGORY_STYLES[event.category];
            return (
              <li
                key={event.id}
                className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
              >
                <span
                  aria-hidden="true"
                  className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", style.dot)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-white">
                      {event.label}
                    </span>
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider text-white/50"
                      aria-label={`Category ${style.label}`}
                    >
                      {style.label}
                    </span>
                  </div>
                  {event.timestamp && (
                    <p className="mt-0.5 text-[11px] text-white/50">
                      <time dateTime={event.timestamp}>{event.timestamp}</time>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
