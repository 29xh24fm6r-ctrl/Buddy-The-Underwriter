"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerResponseNeededItem } from "@/lib/borrower/buildBorrowerCommunicationViewModel";

const PRIORITY_STYLES: Record<
  BorrowerResponseNeededItem["priority"],
  { pillBg: string; pillText: string; label: string; dot: string }
> = {
  required: {
    pillBg: "bg-amber-100",
    pillText: "text-amber-900",
    label: "Required",
    dot: "bg-amber-500",
  },
  helpful: {
    pillBg: "bg-sky-100",
    pillText: "text-sky-900",
    label: "Helpful",
    dot: "bg-sky-500",
  },
  optional: {
    pillBg: "bg-slate-100",
    pillText: "text-slate-700",
    label: "Optional",
    dot: "bg-slate-400",
  },
};

export function BorrowerResponseNeededCard({
  items,
}: {
  items: BorrowerResponseNeededItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
          <Icon name="fact_check" className="h-4 w-4 text-slate-700" />
        </div>
        <h3 className="font-heading text-sm font-semibold text-slate-900">
          Items needing your response
        </h3>
      </div>

      <p className="mt-2 text-xs text-slate-600">
        Each item below explains why Buddy is asking and what to do next.
      </p>

      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const style = PRIORITY_STYLES[item.priority];
          return (
            <li
              key={item.id}
              className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        style.pillBg,
                        style.pillText,
                      )}
                    >
                      <span
                        className={cn("h-1.5 w-1.5 rounded-full", style.dot)}
                        aria-hidden="true"
                      />
                      {style.label}
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {item.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-700">
                    {item.reason}
                  </p>
                </div>
                {item.href && (
                  <a
                    href={item.href}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl brand-gradient-cta px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand-blue-500 focus:ring-offset-2"
                  >
                    <Icon
                      name="arrow_forward_ios"
                      className="h-3 w-3 text-current"
                    />
                    Respond
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
