"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerJourneyAction } from "@/lib/borrower/buildBorrowerJourneyViewModel";

export function BorrowerJourneyActionCard({
  action,
}: {
  action?: BorrowerJourneyAction;
}) {
  if (!action) {
    return (
      <section className="rounded-[1.5rem] border border-emerald-200/70 bg-[linear-gradient(135deg,_#ecfdf5_0%,_#f0fdf4_100%)] p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/90 shadow-sm">
            <Icon name="check_circle" className="h-5 w-5 text-emerald-700" />
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            All caught up
          </div>
        </div>
        <h2 className="mt-3 text-xl font-semibold text-emerald-950 sm:text-2xl">
          No action needed right now
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-800/80">
          Your application is being reviewed by the team. We will notify you
          if anything else is needed.
        </p>
      </section>
    );
  }

  const isCritical = action.severity === "critical";
  const isRecommended = action.severity === "recommended";

  return (
    <section
      className={cn(
        "rounded-[1.5rem] border p-5 shadow-[0_14px_40px_rgba(120,53,15,0.08)] sm:p-6",
        isCritical
          ? "border-amber-200 bg-[linear-gradient(135deg,_#fffdf8_0%,_#fff7ed_100%)]"
          : isRecommended
            ? "border-sky-200/70 bg-[linear-gradient(135deg,_#f0f9ff_0%,_#e0f2fe_100%)]"
            : "border-stone-200 bg-[linear-gradient(135deg,_#fffdf8_0%,_#fff7ed_100%)]",
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
              isCritical ? "text-amber-700" : "text-sky-700",
            )}
          >
            <Icon
              name={isCritical ? "auto_awesome" : "auto_awesome"}
              className={cn(
                "h-4 w-4",
                isCritical ? "text-amber-700" : "text-sky-600",
              )}
            />
            {isCritical ? "Your next step" : "Recommended"}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-stone-950 sm:text-2xl">
              {action.label}
            </h2>
            {action.description && (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-700 sm:text-base">
                {action.description}
              </p>
            )}
          </div>
        </div>

        {action.href && action.ctaLabel && (
          <div className="w-full max-w-sm">
            <a
              href={action.href}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            >
              <Icon
                name="arrow_forward_ios"
                className="h-4 w-4 text-current"
              />
              {action.ctaLabel}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
