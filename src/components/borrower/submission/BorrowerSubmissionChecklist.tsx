"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerSubmissionChecklistItem } from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";

export function BorrowerSubmissionChecklist({
  items,
}: {
  items: BorrowerSubmissionChecklistItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
          <Icon name="checklist" className="h-4 w-4 text-slate-700" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">
          Package readiness checklist
        </h3>
      </div>

      <ul className="mt-4 space-y-2" role="list" aria-label="Submission checklist">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3"
          >
            <div
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                item.completed
                  ? "bg-emerald-100"
                  : "border border-slate-300 bg-white",
              )}
              aria-hidden="true"
            >
              {item.completed && (
                <Icon
                  name="check_circle"
                  className="h-4 w-4 text-emerald-600"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "text-sm font-semibold",
                  item.completed ? "text-slate-900" : "text-slate-700",
                )}
              >
                {item.label}
              </div>
              {item.description && (
                <p className="mt-0.5 text-xs leading-5 text-slate-600">
                  {item.description}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
