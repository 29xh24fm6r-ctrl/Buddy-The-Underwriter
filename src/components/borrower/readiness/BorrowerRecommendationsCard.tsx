"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerRecommendation } from "@/lib/borrower/buildBorrowerReadinessViewModel";

const PRIORITY_STYLES = {
  high: {
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-800",
    badgeLabel: "High impact",
  },
  medium: {
    dot: "bg-sky-400",
    badge: "bg-sky-100 text-sky-800",
    badgeLabel: "Helpful",
  },
  low: {
    dot: "bg-stone-300",
    badge: "bg-stone-100 text-stone-600",
    badgeLabel: "Optional",
  },
} as const;

export function BorrowerRecommendationsCard({
  recommendations,
}: {
  recommendations: BorrowerRecommendation[];
}) {
  const isFallback =
    recommendations.length === 1 && recommendations[0].id === "rec_fallback";

  return (
    <section className="rounded-[1.5rem] border border-sky-200/60 bg-[linear-gradient(135deg,_rgba(240,249,255,0.6)_0%,_rgba(224,242,254,0.3)_100%)] p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100">
          <Icon name="auto_awesome" className="h-4 w-4 text-sky-700" />
        </div>
        <h3 className="text-sm font-semibold text-sky-900">
          Buddy Recommends
        </h3>
      </div>

      {isFallback ? (
        <p className="mt-3 text-sm text-sky-800/80">
          {recommendations[0].explanation ?? recommendations[0].label}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {recommendations.map((rec) => {
            const style = PRIORITY_STYLES[rec.priority];
            return (
              <li
                key={rec.id}
                className="rounded-xl border border-white/80 bg-white/70 p-4 transition-shadow hover:shadow-sm"
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
                      <span className="text-sm font-medium text-stone-900">
                        {rec.label}
                      </span>
                    </div>
                    {rec.explanation && (
                      <p className="mt-1 pl-4 text-xs text-stone-600">
                        {rec.explanation}
                      </p>
                    )}
                    <span
                      className={cn(
                        "mt-2 ml-4 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        style.badge,
                      )}
                    >
                      {style.badgeLabel}
                    </span>
                  </div>
                  {rec.href && (
                    <a
                      href={rec.href}
                      className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-stone-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-800"
                    >
                      Upload
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
      )}
    </section>
  );
}
