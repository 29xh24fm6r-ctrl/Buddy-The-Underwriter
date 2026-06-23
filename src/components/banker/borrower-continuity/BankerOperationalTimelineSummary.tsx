"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BankerOperationalTimelineEvent,
  BankerOperationalTimelineEventCategory,
} from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";

const CATEGORY_STYLES: Record<
  BankerOperationalTimelineEventCategory,
  { dot: string; label: string }
> = {
  document: { dot: "bg-sky-500", label: "Document" },
  borrower_action: { dot: "bg-amber-500", label: "Borrower action" },
  banker_action: { dot: "bg-stone-700", label: "Banker action" },
  review: { dot: "bg-emerald-500", label: "Review" },
  submission: { dot: "bg-emerald-600", label: "Submission" },
  communication: { dot: "bg-stone-500", label: "Communication" },
};

export function BankerOperationalTimelineSummary({
  events,
}: {
  events: BankerOperationalTimelineEvent[];
}) {
  return (
    <section
      role="region"
      aria-label="Recent operational events"
      className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-100">
          <Icon name="history" className="h-4 w-4 text-stone-700" />
        </div>
        <h3 className="text-sm font-semibold text-stone-900">Recent activity</h3>
      </div>

      {events.length === 0 ? (
        <p className="mt-3 text-sm italic text-stone-600">
          No recent borrower activity recorded.
        </p>
      ) : (
        <ol
          className="mt-4 space-y-2"
          role="list"
          aria-label="Operational timeline"
        >
          {events.map((event) => {
            const style = CATEGORY_STYLES[event.category];
            return (
              <li
                key={event.id}
                className="flex items-start gap-3 rounded-xl border border-stone-100 bg-stone-50/40 px-3 py-2"
              >
                <span
                  className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", style.dot)}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-stone-900">
                      {event.label}
                    </span>
                    <span
                      className="text-[11px] font-semibold uppercase tracking-wider text-stone-500"
                      aria-label={style.label}
                    >
                      {style.label}
                    </span>
                  </div>
                  {event.description && (
                    <p className="mt-0.5 text-xs leading-5 text-stone-600">
                      {event.description}
                    </p>
                  )}
                  {event.timestamp && (
                    <p className="mt-0.5 text-[11px] text-stone-500">
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
