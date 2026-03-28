"use client";

/**
 * Phase 65H — Focus Rail
 *
 * Small right rail: "don't miss this" items.
 * Shows auto-advanced, newly critical, borrower submissions, changed since viewed.
 */

import Link from "next/link";
import type { BankerQueueItem } from "@/core/command-center/types";

type Props = {
  items: BankerQueueItem[];
};

type FocusSection = {
  title: string;
  items: BankerQueueItem[];
  emptyLabel: string;
};

export default function CommandCenterFocusRail({ items }: Props) {
  const critical = items.filter((i) => i.urgencyBucket === "critical");
  const reviewNeeded = items.filter(
    (i) => i.queueReasonCode === "uploads_waiting_review",
  );
  const changed = items.filter((i) => i.changedSinceViewed);
  const executable = items.filter((i) => i.actionability === "execute_now");

  const sections: FocusSection[] = [
    { title: "Critical Now", items: critical, emptyLabel: "None" },
    { title: "Awaiting Review", items: reviewNeeded, emptyLabel: "Clear" },
    { title: "Changed Since Viewed", items: changed, emptyLabel: "All seen" },
    { title: "Ready to Execute", items: executable, emptyLabel: "None" },
  ];

  return (
    <div className="w-[240px] shrink-0 space-y-4">
      {sections.map((section) => (
        <div key={section.title} className="glass-card rounded-xl p-3">
          <h4 className="text-[10px] font-bold text-white/50 uppercase tracking-wider mb-2">
            {section.title}
          </h4>
          {section.items.length === 0 ? (
            <p className="text-xs text-white/20">{section.emptyLabel}</p>
          ) : (
            <div className="space-y-1">
              {section.items.slice(0, 5).map((item) => (
                <Link
                  key={item.dealId}
                  href={item.href ?? `/deals/${item.dealId}`}
                  className="block text-xs text-white/60 hover:text-white/90 truncate transition"
                >
                  {item.dealName}
                </Link>
              ))}
              {section.items.length > 5 && (
                <p className="text-[10px] text-white/30">
                  +{section.items.length - 5} more
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
