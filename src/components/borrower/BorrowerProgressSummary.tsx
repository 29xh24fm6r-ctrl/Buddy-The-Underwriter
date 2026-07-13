"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerJourneyAction } from "@/lib/borrower/buildBorrowerJourneyViewModel";

function CompletedCard({
  items,
}: {
  items: BorrowerJourneyAction[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-emerald-200/70 bg-emerald-50/50 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100">
          <Icon name="check_circle" className="h-4 w-4 text-emerald-700" />
        </div>
        <h3 className="text-sm font-semibold text-emerald-900">Completed</h3>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-emerald-700/80">
          Your accomplishments will appear here as Buddy processes your package.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <Icon
                name="check_circle"
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
              />
              <div>
                <div className="text-sm font-medium text-emerald-900">
                  {item.label}
                </div>
                {item.description && (
                  <div className="text-xs text-emerald-700/80">
                    {item.description}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RemainingCard({
  items,
}: {
  items: BorrowerJourneyAction[];
}) {
  const isFallback =
    items.length === 1 && items[0].id === "fallback_remaining";

  return (
    <section className="rounded-[1.5rem] border border-amber-200/70 bg-amber-50/50 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100">
          <Icon name="pending" className="h-4 w-4 text-amber-700" />
        </div>
        <h3 className="text-sm font-semibold text-amber-900">Still Needed</h3>
      </div>
      {isFallback ? (
        <p className="mt-3 text-sm text-amber-700/80">
          {items[0].description ?? items[0].label}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <div
                className={cn(
                  "mt-1 h-2 w-2 shrink-0 rounded-full",
                  item.severity === "critical"
                    ? "bg-rose-400"
                    : item.severity === "important"
                      ? "bg-amber-400"
                      : "bg-slate-300",
                )}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-amber-900">
                  {item.label}
                </div>
                {item.description && (
                  <div className="text-xs text-amber-700/80">
                    {item.description}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BorrowerProgressSummary({
  completedItems,
  remainingItems,
}: {
  completedItems: BorrowerJourneyAction[];
  remainingItems: BorrowerJourneyAction[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <CompletedCard items={completedItems} />
      <RemainingCard items={remainingItems} />
    </div>
  );
}
