"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BorrowerCommunicationUpdate,
  BorrowerCommunicationUpdateType,
} from "@/lib/borrower/buildBorrowerCommunicationViewModel";

const UPDATE_STYLES: Record<
  BorrowerCommunicationUpdateType,
  { icon: IconName; iconColor: string; bg: string; ring: string }
> = {
  document_received: {
    icon: "check_circle",
    iconColor: "text-emerald-600",
    bg: "bg-emerald-50",
    ring: "ring-emerald-100",
  },
  document_needs_attention: {
    icon: "error",
    iconColor: "text-amber-700",
    bg: "bg-amber-50",
    ring: "ring-amber-100",
  },
  milestone_completed: {
    icon: "check_circle",
    iconColor: "text-emerald-600",
    bg: "bg-emerald-50",
    ring: "ring-emerald-100",
  },
  guidance_updated: {
    icon: "auto_awesome",
    iconColor: "text-sky-700",
    bg: "bg-sky-50",
    ring: "ring-sky-100",
  },
  recommendation_added: {
    icon: "auto_awesome",
    iconColor: "text-sky-700",
    bg: "bg-sky-50",
    ring: "ring-sky-100",
  },
  blocker_added: {
    icon: "error",
    iconColor: "text-rose-700",
    bg: "bg-rose-50",
    ring: "ring-rose-100",
  },
  blocker_resolved: {
    icon: "check_circle",
    iconColor: "text-emerald-700",
    bg: "bg-emerald-50",
    ring: "ring-emerald-100",
  },
  review_started: {
    icon: "sync",
    iconColor: "text-sky-700",
    bg: "bg-sky-50",
    ring: "ring-sky-100",
  },
  no_action_needed: {
    icon: "check_circle",
    iconColor: "text-emerald-600",
    bg: "bg-emerald-50",
    ring: "ring-emerald-100",
  },
};

function formatTimestamp(iso: string): string | null {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

export function BorrowerRecentUpdatesTimeline({
  updates,
}: {
  updates: BorrowerCommunicationUpdate[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
          <Icon name="history" className="h-4 w-4 text-slate-700" />
        </div>
        <h3 className="font-heading text-sm font-semibold text-slate-900">Recent updates</h3>
      </div>

      {updates.length === 0 ? (
        <p className="mt-3 text-xs text-slate-600">
          Buddy will show recent updates here as your package moves forward.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {updates.map((update) => {
            const style = UPDATE_STYLES[update.type];
            const when = update.timestamp
              ? formatTimestamp(update.timestamp)
              : null;
            return (
              <li key={update.id} className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2",
                    style.bg,
                    style.ring,
                  )}
                >
                  <Icon
                    name={style.icon}
                    className={cn("h-3.5 w-3.5", style.iconColor)}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {update.label}
                    </span>
                    {when && (
                      <span className="text-[11px] font-medium text-slate-500">
                        {when}
                      </span>
                    )}
                  </div>
                  {update.description && (
                    <p className="mt-0.5 text-xs leading-5 text-slate-600">
                      {update.description}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
