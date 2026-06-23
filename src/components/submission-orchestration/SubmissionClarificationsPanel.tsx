"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  SubmissionClarificationItem,
  SubmissionClarificationStatus,
} from "@/lib/banker/buildSubmissionOrchestrationViewModel";
import { SUBMISSION_CLARIFICATION_STATUS_LABELS } from "@/lib/banker/buildSubmissionOrchestrationViewModel";

const STATUS_STYLES: Record<
  SubmissionClarificationStatus,
  { pillBg: string; pillText: string; dot: string }
> = {
  open: {
    pillBg: "bg-rose-500/15 ring-1 ring-rose-400/30",
    pillText: "text-rose-200",
    dot: "bg-rose-400",
  },
  needs_review: {
    pillBg: "bg-amber-500/15 ring-1 ring-amber-400/30",
    pillText: "text-amber-200",
    dot: "bg-amber-400",
  },
  resolved: {
    pillBg: "bg-emerald-500/15 ring-1 ring-emerald-400/30",
    pillText: "text-emerald-200",
    dot: "bg-emerald-400",
  },
  unavailable: {
    pillBg: "bg-white/5 ring-1 ring-white/10",
    pillText: "text-stone-400",
    dot: "bg-stone-500",
  },
};

const PRIORITY_LABEL: Record<SubmissionClarificationItem["priority"], string> = {
  required: "Required",
  helpful: "Helpful",
  optional: "Optional",
};

const SOURCE_LABEL: Record<SubmissionClarificationItem["source"], string> = {
  document: "Document",
  communication: "Communication",
  guidance: "Guidance",
  submission_prep: "Submission prep",
  banker_review: "Banker review",
};

export function SubmissionClarificationsPanel({
  items,
}: {
  items: SubmissionClarificationItem[];
}) {
  return (
    <section
      role="region"
      aria-label="Submission clarifications"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="fact_check" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Clarification tracking</h3>
        <span className="ml-auto inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">
          {items.length}
        </span>
      </header>

      {items.length === 0 ? (
        <p className="mt-3 text-sm italic text-white/60">
          No outstanding clarifications on this deal.
        </p>
      ) : (
        <ul
          className="mt-4 space-y-2"
          role="list"
          aria-label="Clarification items"
        >
          {items.map((item) => {
            const style = STATUS_STYLES[item.status];
            const statusLabel = SUBMISSION_CLARIFICATION_STATUS_LABELS[item.status];
            return (
              <li
                key={item.id}
                className="rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 rounded-full", style.dot)}
                  />
                  <span className="text-sm font-semibold text-white">
                    {item.label}
                  </span>
                  <span
                    className={cn(
                      "ml-auto inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      style.pillBg,
                      style.pillText,
                    )}
                    aria-label={`Status: ${statusLabel}`}
                  >
                    {statusLabel}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  <span aria-label={`Priority ${PRIORITY_LABEL[item.priority]}`}>
                    {PRIORITY_LABEL[item.priority]}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span aria-label={`Source ${SOURCE_LABEL[item.source]}`}>
                    {SOURCE_LABEL[item.source]}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-white/70">{item.reason}</p>
                {item.href && (
                  <div className="mt-2">
                    <a
                      href={item.href}
                      aria-label={`Resolve clarification: ${item.label}`}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    >
                      Resolve
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
