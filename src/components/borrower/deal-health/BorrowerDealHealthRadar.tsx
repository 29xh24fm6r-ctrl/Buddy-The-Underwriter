"use client";

import { cn } from "@/lib/cn";
import type {
  BorrowerDealHealthCategory,
  BorrowerDealHealthStatus,
} from "@/lib/borrower/buildBorrowerDealHealthViewModel";

const STATUS_BAR_COLOR: Record<BorrowerDealHealthStatus, string> = {
  strong: "bg-emerald-500",
  progressing: "bg-amber-400",
  needs_attention: "bg-rose-400",
  not_started: "bg-slate-200",
  unavailable: "bg-slate-100",
};

const STATUS_BAR_WIDTH: Record<BorrowerDealHealthStatus, string> = {
  strong: "w-full",
  progressing: "w-3/5",
  needs_attention: "w-2/5",
  not_started: "w-1/6",
  unavailable: "w-0",
};

export function BorrowerDealHealthRadar({
  categories,
}: {
  categories: BorrowerDealHealthCategory[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        Package Health
      </div>
      <h3 className="mt-1 text-sm font-heading font-semibold text-slate-900">
        Submission Readiness by Category
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Buddy uses uploaded information to help prepare your lender package.
      </p>

      <div className="mt-5 space-y-3">
        {categories.map((cat) => {
          const barColor = STATUS_BAR_COLOR[cat.status];
          const barWidth =
            cat.score != null
              ? `${Math.max(cat.score, 4)}%`
              : undefined;
          const fallbackWidth = STATUS_BAR_WIDTH[cat.status];

          return (
            <div key={cat.id}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">
                  {cat.label}
                </span>
                {cat.score != null ? (
                  <span className="text-xs font-semibold text-slate-600">
                    {cat.score}%
                  </span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-slate-400">
                    {cat.status === "unavailable" ? "Pending" : cat.status === "not_started" ? "Not started" : ""}
                  </span>
                )}
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    barColor,
                    barWidth ? undefined : fallbackWidth,
                  )}
                  style={barWidth ? { width: barWidth } : undefined}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
