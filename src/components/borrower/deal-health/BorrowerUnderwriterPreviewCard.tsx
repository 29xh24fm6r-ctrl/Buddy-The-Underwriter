"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerReviewerPreviewItem } from "@/lib/borrower/buildBorrowerDealHealthViewModel";

const TYPE_CONFIG: Record<
  BorrowerReviewerPreviewItem["type"],
  { sectionLabel: string; icon: "check_circle" | "error" | "pending"; iconColor: string; bgColor: string }
> = {
  strength: {
    sectionLabel: "Visible Strengths",
    icon: "check_circle",
    iconColor: "text-emerald-600",
    bgColor: "bg-emerald-50",
  },
  needed: {
    sectionLabel: "Still Needed",
    icon: "error",
    iconColor: "text-amber-600",
    bgColor: "bg-amber-50",
  },
  clarification: {
    sectionLabel: "May Need Clarification",
    icon: "pending",
    iconColor: "text-sky-600",
    bgColor: "bg-sky-50",
  },
};

export function BorrowerUnderwriterPreviewCard({
  items,
}: {
  items: BorrowerReviewerPreviewItem[];
}) {
  const strengths = items.filter((i) => i.type === "strength");
  const needed = items.filter((i) => i.type === "needed");
  const clarifications = items.filter((i) => i.type === "clarification");

  const sections = [
    { key: "strength" as const, items: strengths },
    { key: "needed" as const, items: needed },
    { key: "clarification" as const, items: clarifications },
  ].filter((s) => s.items.length > 0);

  const hasStrengths = strengths.length > 0;
  const hasNeeded = needed.length > 0;

  let headerCopy: string;
  if (hasStrengths && !hasNeeded) {
    headerCopy =
      "Buddy has enough information to begin reviewing your document package.";
  } else if (hasStrengths && hasNeeded) {
    headerCopy =
      "Buddy has enough information to begin reviewing your document package, but a few items are still needed before lender submission.";
  } else {
    headerCopy =
      "Buddy is waiting for documents to begin building your review preview.";
  }

  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-100">
          <Icon name="fact_check" className="h-4 w-4 text-stone-600" />
        </div>
        <h3 className="text-sm font-semibold text-stone-900">
          What a Reviewer Can See So Far
        </h3>
      </div>
      <p className="mt-2 text-sm text-stone-600">
        {headerCopy}
      </p>
      <p className="mt-1 text-xs text-stone-400">
        Some items may change as your banker reviews the file.
      </p>

      <div className="mt-4 space-y-4">
        {sections.map(({ key, items: sectionItems }) => {
          const config = TYPE_CONFIG[key];
          return (
            <div key={key}>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                {config.sectionLabel}
              </div>
              <ul className="mt-2 space-y-2">
                {sectionItems.map((item) => (
                  <li
                    key={item.id}
                    className={cn(
                      "flex items-start gap-2 rounded-lg p-2",
                      config.bgColor,
                    )}
                  >
                    <Icon
                      name={config.icon}
                      className={cn("mt-0.5 h-4 w-4 shrink-0", config.iconColor)}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-stone-800">
                        {item.label}
                      </div>
                      {item.description && (
                        <div className="text-xs text-stone-500">
                          {item.description}
                        </div>
                      )}
                    </div>
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
