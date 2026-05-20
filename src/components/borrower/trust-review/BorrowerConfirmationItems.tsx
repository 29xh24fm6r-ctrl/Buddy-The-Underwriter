"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BorrowerConfirmationItem,
  BorrowerConfirmationStatus,
} from "@/lib/borrower/buildBorrowerTrustReviewViewModel";

const STATUS_STYLES: Record<
  BorrowerConfirmationStatus,
  { dot: string; pillBg: string; pillText: string; label: string }
> = {
  confirmed: {
    dot: "bg-emerald-500",
    pillBg: "bg-emerald-100",
    pillText: "text-emerald-900",
    label: "Confirmed",
  },
  needs_confirmation: {
    dot: "bg-sky-500",
    pillBg: "bg-sky-100",
    pillText: "text-sky-900",
    label: "Needs confirmation",
  },
  missing: {
    dot: "bg-amber-500",
    pillBg: "bg-amber-100",
    pillText: "text-amber-900",
    label: "Missing",
  },
  not_applicable: {
    dot: "bg-stone-400",
    pillBg: "bg-stone-100",
    pillText: "text-stone-700",
    label: "Not needed right now",
  },
};

export function BorrowerConfirmationItems({
  items,
}: {
  items: BorrowerConfirmationItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section
      role="region"
      aria-label="Open confirmation items"
      className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-100">
          <Icon name="check_circle" className="h-4 w-4 text-stone-700" />
        </div>
        <h3 className="text-sm font-semibold text-stone-900">
          Open confirmation items
        </h3>
      </div>

      <ul
        className="mt-4 space-y-2"
        role="list"
        aria-label="Confirmation items"
      >
        {items.map((item) => {
          const style = STATUS_STYLES[item.status];
          return (
            <li
              key={item.id}
              className="rounded-xl border border-stone-100 bg-stone-50/50 p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                        style.pillBg,
                        style.pillText,
                      )}
                      aria-label={style.label}
                    >
                      <span
                        aria-hidden="true"
                        className={cn("h-1.5 w-1.5 rounded-full", style.dot)}
                      />
                      {style.label}
                    </span>
                    <span className="text-sm font-semibold text-stone-900">
                      {item.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-stone-700">
                    {item.description}
                  </p>
                </div>
                {item.href && (
                  <a
                    href={item.href}
                    aria-label={`Update for ${item.label}`}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                  >
                    <Icon name="edit" className="h-3.5 w-3.5 text-current" />
                    Update
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
