"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  SubmissionOrchestrationTimelineEvent,
  SubmissionOrchestrationTimelineCategory,
} from "@/lib/banker/buildSubmissionOrchestrationViewModel";

const CATEGORY_STYLES: Record<
  SubmissionOrchestrationTimelineCategory,
  { dot: string; label: string }
> = {
  gate: { dot: "bg-sky-400", label: "Gate" },
  package: { dot: "bg-emerald-400", label: "Package" },
  clarification: { dot: "bg-amber-400", label: "Clarification" },
  banker_review: { dot: "bg-white", label: "Banker review" },
  borrower_action: { dot: "bg-stone-400", label: "Borrower action" },
  submission: { dot: "bg-emerald-500", label: "Submission" },
};

export function SubmissionOrchestrationTimeline({
  events,
}: {
  events: SubmissionOrchestrationTimelineEvent[];
}) {
  return (
    <section
      role="region"
      aria-label="Submission orchestration timeline"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="history" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Orchestration timeline</h3>
      </header>

      {events.length === 0 ? (
        <p className="mt-3 text-sm italic text-white/60">
          No orchestration events recorded yet.
        </p>
      ) : (
        <ol
          className="mt-3 space-y-2"
          role="list"
          aria-label="Orchestration events"
        >
          {events.map((event) => {
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
                      aria-label={style.label}
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
