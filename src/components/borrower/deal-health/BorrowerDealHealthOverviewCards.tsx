"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BorrowerDealHealthCategory,
  BorrowerDealHealthStatus,
} from "@/lib/borrower/buildBorrowerDealHealthViewModel";

const STATUS_STYLES: Record<
  BorrowerDealHealthStatus,
  { border: string; bg: string; icon: "check_circle" | "pending" | "error" | "remove" | "pending"; iconColor: string; badgeColor: string; badgeLabel: string }
> = {
  strong: {
    border: "border-emerald-200/70",
    bg: "bg-emerald-50/40",
    icon: "check_circle",
    iconColor: "text-emerald-600",
    badgeColor: "bg-emerald-100 text-emerald-800",
    badgeLabel: "Strong",
  },
  progressing: {
    border: "border-amber-200/70",
    bg: "bg-amber-50/40",
    icon: "pending",
    iconColor: "text-amber-600",
    badgeColor: "bg-amber-100 text-amber-800",
    badgeLabel: "Progressing",
  },
  needs_attention: {
    border: "border-rose-200/70",
    bg: "bg-rose-50/40",
    icon: "error",
    iconColor: "text-rose-600",
    badgeColor: "bg-rose-100 text-rose-800",
    badgeLabel: "Needs Attention",
  },
  not_started: {
    border: "border-stone-200",
    bg: "bg-stone-50/40",
    icon: "remove",
    iconColor: "text-stone-400",
    badgeColor: "bg-stone-100 text-stone-600",
    badgeLabel: "Not Started",
  },
  unavailable: {
    border: "border-stone-200",
    bg: "bg-stone-50/30",
    icon: "pending",
    iconColor: "text-stone-300",
    badgeColor: "bg-stone-100 text-stone-500",
    badgeLabel: "Pending",
  },
};

function ConfidenceIndicator({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const bars = confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
  return (
    <div className="flex items-end gap-0.5" title={`${confidence} confidence`}>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            "w-1 rounded-sm",
            i <= bars ? "bg-stone-400" : "bg-stone-200",
            i === 1 ? "h-1.5" : i === 2 ? "h-2.5" : "h-3.5",
          )}
        />
      ))}
    </div>
  );
}

export function BorrowerDealHealthOverviewCards({
  categories,
}: {
  categories: BorrowerDealHealthCategory[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-100">
          <Icon name="analytics" className="h-4 w-4 text-stone-600" />
        </div>
        <h3 className="text-sm font-semibold text-stone-900">
          Deal Health Overview
        </h3>
      </div>
      <p className="mt-2 text-xs text-stone-500">
        Readiness reflects package completeness, not loan approval.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => {
          const style = STATUS_STYLES[cat.status];
          return (
            <div
              key={cat.id}
              className={cn(
                "rounded-xl border p-4 transition-shadow hover:shadow-sm",
                style.border,
                style.bg,
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Icon
                    name={style.icon}
                    className={cn("h-4 w-4 shrink-0", style.iconColor)}
                  />
                  <span className="text-sm font-semibold text-stone-900">
                    {cat.label}
                  </span>
                </div>
                <ConfidenceIndicator confidence={cat.confidence} />
              </div>

              <div className="mt-2 flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                    style.badgeColor,
                  )}
                >
                  {style.badgeLabel}
                </span>
                {cat.score != null && (
                  <span className="text-xs font-semibold text-stone-600">
                    {cat.score}%
                  </span>
                )}
              </div>

              <p className="mt-2 text-xs leading-relaxed text-stone-600">
                {cat.summary}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
