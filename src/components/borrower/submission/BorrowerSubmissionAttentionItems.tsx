"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerSubmissionAttentionItem } from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";

const PRIORITY_STYLES: Record<
  BorrowerSubmissionAttentionItem["priority"],
  { pillBg: string; pillText: string; label: string }
> = {
  required: { pillBg: "bg-amber-100", pillText: "text-amber-900", label: "Required before submission" },
  helpful: { pillBg: "bg-sky-100", pillText: "text-sky-900", label: "Reduces follow-up" },
  optional: { pillBg: "bg-slate-100", pillText: "text-slate-700", label: "Optional context" },
};

export function BorrowerSubmissionAttentionItems({
  items,
}: {
  items: BorrowerSubmissionAttentionItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-[1.5rem] border border-amber-200/60 bg-amber-50/30 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100">
          <Icon name="error" className="h-4 w-4 text-amber-700" />
        </div>
        <h3 className="text-sm font-semibold text-amber-900">
          Still needed before submission preparation
        </h3>
      </div>

      <ul className="mt-4 space-y-2">
        {items.map((item) => {
          const style = PRIORITY_STYLES[item.priority];
          return (
            <li
              key={item.id}
              className="rounded-xl border border-amber-100 bg-white p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        style.pillBg,
                        style.pillText,
                      )}
                    >
                      {style.label}
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {item.label}
                    </span>
                  </div>
                  {item.description && (
                    <p className="mt-1 text-xs leading-5 text-slate-700">
                      {item.description}
                    </p>
                  )}
                </div>
                {item.href && (
                  <a
                    href={item.href}
                    aria-label={`Respond to ${item.label}`}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl brand-gradient-cta px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue-500 focus-visible:ring-offset-2"
                  >
                    <Icon name="cloud_upload" className="h-3.5 w-3.5 text-current" />
                    Upload
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
