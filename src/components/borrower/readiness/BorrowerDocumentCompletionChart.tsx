"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export function BorrowerDocumentCompletionChart({
  received,
  underReview,
  remaining,
  completionPercent,
}: {
  received: number;
  underReview: number;
  remaining: number;
  completionPercent: number;
}) {
  const total = received + underReview + remaining;
  const receivedPct = total > 0 ? (received / total) * 100 : 0;
  const reviewPct = total > 0 ? (underReview / total) * 100 : 0;

  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-100">
            <Icon name="description" className="h-4 w-4 text-stone-600" />
          </div>
          <h3 className="text-sm font-semibold text-stone-900">
            Document Package
          </h3>
        </div>
        <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
          {completionPercent}% complete
        </span>
      </div>

      {/* Stacked bar */}
      <div
        className="mt-4 flex h-3 overflow-hidden rounded-full bg-stone-100"
        aria-hidden="true"
      >
        {receivedPct > 0 && (
          <div
            className="rounded-l-full bg-emerald-500 transition-all duration-700"
            style={{ width: `${receivedPct}%` }}
          />
        )}
        {reviewPct > 0 && (
          <div
            className="bg-amber-400 transition-all duration-700"
            style={{ width: `${reviewPct}%` }}
          />
        )}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        <LegendItem color="bg-emerald-500" label="Received" count={received} />
        <LegendItem color="bg-amber-400" label="Under review" count={underReview} />
        <LegendItem color="bg-stone-200" label="Remaining" count={remaining} />
      </div>
    </section>
  );
}

function LegendItem({
  color,
  label,
  count,
}: {
  color: string;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn("h-2.5 w-2.5 rounded-full", color)} />
      <span className="text-xs text-stone-600">
        {label}{" "}
        <span className="font-semibold text-stone-800">{count}</span>
      </span>
    </div>
  );
}
