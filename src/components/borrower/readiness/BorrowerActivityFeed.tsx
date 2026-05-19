"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerActivityEvent } from "@/lib/borrower/buildBorrowerReadinessViewModel";

const CATEGORY_ICON: Record<
  BorrowerActivityEvent["category"],
  { name: "cloud_upload" | "fact_check" | "check_circle" | "rocket_launch" | "description"; color: string }
> = {
  upload: { name: "cloud_upload", color: "text-amber-600" },
  review: { name: "fact_check", color: "text-sky-600" },
  verification: { name: "check_circle", color: "text-emerald-600" },
  milestone: { name: "rocket_launch", color: "text-teal-600" },
  request: { name: "description", color: "text-stone-600" },
};

function RelativeTime({ iso }: { iso: string }) {
  const [label, setLabel] = React.useState<string>("");

  React.useEffect(() => {
    function compute() {
      const diffMs = Date.now() - new Date(iso).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    }
    setLabel(compute());
  }, [iso]);

  // SSR: render empty to avoid hydration mismatch
  if (!label) return null;
  return <span className="shrink-0 text-xs text-stone-400">{label}</span>;
}

export function BorrowerActivityFeed({
  events,
}: {
  events: BorrowerActivityEvent[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-100">
          <Icon name="history" className="h-4 w-4 text-stone-600" />
        </div>
        <h3 className="text-sm font-semibold text-stone-900">
          Recent Activity
        </h3>
      </div>

      {events.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">
          Buddy will show package activity here as your documents are received
          and reviewed.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {events.map((event) => {
            const icon = CATEGORY_ICON[event.category];
            return (
              <li
                key={event.id}
                className="flex items-center gap-3 rounded-xl border border-stone-100 bg-stone-50/50 px-4 py-3 transition-colors hover:bg-stone-50"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
                  <Icon
                    name={icon.name}
                    className={cn("h-4 w-4", icon.color)}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-stone-800">
                    {event.label}
                  </div>
                </div>
                <RelativeTime iso={event.timestamp} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
