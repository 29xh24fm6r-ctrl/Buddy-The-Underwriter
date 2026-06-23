"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import type {
  BankerCommandCenterSection,
  BankerCommandCenterQueueCategory,
} from "@/lib/banker/buildBankerCommandCenterViewModel";
import { BankerDealQueueCard } from "@/components/command-center/BankerDealQueueCard";

const CATEGORY_ICON: Record<BankerCommandCenterQueueCategory, IconName> = {
  operationally_blocked: "error",
  needs_clarification: "fact_check",
  banker_action_required: "play_arrow",
  ready_for_banker_review: "checklist",
  ready_for_submission_prep: "rocket_launch",
  borrower_action_required: "pending",
  stalled: "history",
  monitoring: "analytics",
};

export function BankerOperationalQueueSection({
  section,
}: {
  section: BankerCommandCenterSection;
}) {
  if (section.items.length === 0) return null;

  const iconName = CATEGORY_ICON[section.id];

  return (
    <section
      role="region"
      aria-label={section.label}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name={iconName} className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h2 className="text-sm font-semibold text-white">{section.label}</h2>
        <span className="ml-auto inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">
          {section.items.length}
        </span>
      </header>

      <ul
        className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2"
        role="list"
        aria-label={`${section.label} deals`}
      >
        {section.items.map((item) => (
          <li key={item.dealId}>
            <BankerDealQueueCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}
