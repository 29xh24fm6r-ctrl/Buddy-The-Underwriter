"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerJourneyAction } from "@/lib/borrower/buildBorrowerJourneyViewModel";

const SEVERITY_STYLES = {
  critical: {
    dot: "bg-rose-500",
    label: "Needs attention",
    labelColor: "text-rose-700",
    border: "border-rose-200",
  },
  important: {
    dot: "bg-amber-500",
    label: "Recommended",
    labelColor: "text-amber-700",
    border: "border-amber-200",
  },
  recommended: {
    dot: "bg-sky-400",
    label: "Optional but helpful",
    labelColor: "text-sky-700",
    border: "border-sky-200",
  },
} as const;

export function BorrowerBlockersCard({
  blockers,
}: {
  blockers: BorrowerJourneyAction[];
}) {
  if (blockers.length === 0) {
    return (
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100">
            <Icon name="check_circle" className="h-4 w-4 text-emerald-700" />
          </div>
          <h3 className="text-sm font-heading font-semibold text-slate-900">
            Funding Progress
          </h3>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          No major blockers detected right now. Your package is moving forward.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[1.5rem] border border-rose-200/70 bg-rose-50/40 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-100">
          <Icon name="error" className="h-4 w-4 text-rose-700" />
        </div>
        <h3 className="text-sm font-heading font-semibold text-rose-900">
          Needs Your Attention
        </h3>
      </div>

      <ul className="mt-4 space-y-3">
        {blockers.map((blocker) => {
          const severity = blocker.severity ?? "critical";
          const style =
            SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.critical;
          return (
            <li
              key={blocker.id}
              className={cn(
                "rounded-xl border bg-white p-4",
                style.border,
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        style.dot,
                      )}
                    />
                    <span className="text-sm font-semibold text-slate-900">
                      {blocker.label}
                    </span>
                  </div>
                  {blocker.description && (
                    <p className="mt-1 pl-4 text-xs text-slate-600">
                      {blocker.description}
                    </p>
                  )}
                  <div className={cn("mt-1 pl-4 text-xs font-medium", style.labelColor)}>
                    {style.label}
                  </div>
                </div>
                {blocker.href && blocker.ctaLabel && (
                  <a
                    href={blocker.href}
                    className="inline-flex shrink-0 items-center gap-1 rounded-xl brand-gradient-cta px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110"
                  >
                    {blocker.ctaLabel}
                    <Icon
                      name="arrow_forward_ios"
                      className="h-3 w-3 text-current"
                    />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
