"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerDealInsight } from "@/lib/borrower/buildBorrowerReadinessViewModel";

const TYPE_ICON: Record<BorrowerDealInsight["type"], { name: "check_circle" | "rocket_launch" | "fact_check" | "description"; color: string }> = {
  positive: { name: "check_circle", color: "text-emerald-600" },
  progress: { name: "rocket_launch", color: "text-teal-600" },
  verification: { name: "fact_check", color: "text-sky-600" },
  document: { name: "description", color: "text-amber-600" },
};

export function BorrowerDealInsightsCard({
  insights,
}: {
  insights: BorrowerDealInsight[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-emerald-200/60 bg-[linear-gradient(135deg,_rgba(236,253,245,0.6)_0%,_rgba(240,253,244,0.4)_100%)] p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100">
          <Icon name="auto_awesome" className="h-4 w-4 text-emerald-700" />
        </div>
        <h3 className="text-sm font-heading font-semibold text-emerald-900">
          What Improved Your Deal
        </h3>
      </div>

      <ul className="mt-4 space-y-3">
        {insights.map((insight) => {
          const icon = TYPE_ICON[insight.type];
          return (
            <li
              key={insight.id}
              className="flex items-start gap-3 rounded-xl border border-white/80 bg-white/70 p-3 transition-shadow hover:shadow-sm"
            >
              <Icon
                name={icon.name}
                className={cn("mt-0.5 h-4 w-4 shrink-0", icon.color)}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900">
                  {insight.label}
                </div>
                {insight.description && (
                  <div className="mt-0.5 text-xs text-slate-600">
                    {insight.description}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
