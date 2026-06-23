"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerWaitingOn } from "@/lib/borrower/buildBorrowerCommunicationViewModel";

const STYLES: Record<
  BorrowerWaitingOn,
  { icon: IconName; iconColor: string; pillBg: string; pillText: string }
> = {
  borrower: {
    icon: "cloud_upload",
    iconColor: "text-amber-700",
    pillBg: "bg-amber-50",
    pillText: "text-amber-900",
  },
  buddy_review: {
    icon: "sync",
    iconColor: "text-sky-700",
    pillBg: "bg-sky-50",
    pillText: "text-sky-900",
  },
  banker_review: {
    icon: "handshake",
    iconColor: "text-emerald-700",
    pillBg: "bg-emerald-50",
    pillText: "text-emerald-900",
  },
  clarification: {
    icon: "error",
    iconColor: "text-amber-700",
    pillBg: "bg-amber-50",
    pillText: "text-amber-900",
  },
  next_review_step: {
    icon: "pending",
    iconColor: "text-stone-600",
    pillBg: "bg-stone-50",
    pillText: "text-stone-800",
  },
  unknown: {
    icon: "pending",
    iconColor: "text-stone-500",
    pillBg: "bg-stone-50",
    pillText: "text-stone-700",
  },
};

export function BorrowerWaitingOnStatus({
  waitingOn,
  label,
}: {
  waitingOn: BorrowerWaitingOn;
  label: string;
}) {
  const style = STYLES[waitingOn];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold",
        style.pillBg,
        style.pillText,
      )}
    >
      <Icon name={style.icon} className={cn("h-3.5 w-3.5", style.iconColor)} />
      {label}
    </div>
  );
}
