"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerAttentionItem } from "@/lib/borrower/buildBorrowerDealHealthViewModel";

const PRIORITY_CONFIG = {
  required: {
    sectionLabel: "Required before submission",
    dot: "bg-rose-500",
    badge: "bg-rose-100 text-rose-800",
  },
  helpful: {
    sectionLabel: "Helpful for faster review",
    dot: "bg-amber-400",
    badge: "bg-amber-100 text-amber-800",
  },
  optional: {
    sectionLabel: "Optional context",
    dot: "bg-slate-300",
    badge: "bg-slate-100 text-slate-600",
  },
} as const;

export function BorrowerAttentionItems({
  items,
}: {
  items: BorrowerAttentionItem[];
}) {
  const required = items.filter((i) => i.priority === "required");
  const helpful = items.filter((i) => i.priority === "helpful");
  const optional = items.filter((i) => i.priority === "optional");

  const groups = [
    { key: "required" as const, items: required },
    { key: "helpful" as const, items: helpful },
    { key: "optional" as const, items: optional },
  ].filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return (
      <section className="rounded-[1.5rem] border border-emerald-200/60 bg-emerald-50/30 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100">
            <Icon name="check_circle" className="h-4 w-4 text-emerald-700" />
          </div>
          <h3 className="text-sm font-heading font-semibold text-emerald-900">
            Attention Items
          </h3>
        </div>
        <p className="mt-3 text-sm text-emerald-700">
          No outstanding items. Your package is looking good.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
          <Icon name="checklist" className="h-4 w-4 text-slate-600" />
        </div>
        <h3 className="text-sm font-heading font-semibold text-slate-900">
          Attention Items
        </h3>
      </div>

      <div className="mt-4 space-y-5">
        {groups.map(({ key, items: groupItems }) => {
          const config = PRIORITY_CONFIG[key];
          return (
            <div key={key}>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {config.sectionLabel}
              </div>
              <ul className="mt-2 space-y-2">
                {groupItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <div
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          config.dot,
                        )}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800">
                          {item.label}
                        </div>
                        {item.description && (
                          <div className="mt-0.5 text-xs text-slate-500">
                            {item.description}
                          </div>
                        )}
                      </div>
                    </div>
                    {item.href && (
                      <a
                        href={item.href}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg brand-gradient-cta px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                      >
                        Upload
                        <Icon
                          name="arrow_forward_ios"
                          className="h-3 w-3 text-current"
                        />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
