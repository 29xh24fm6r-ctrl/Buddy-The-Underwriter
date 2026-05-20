"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BankerNextBestAction,
  BankerNextBestActionUrgency,
} from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";

const URGENCY_STYLES: Record<
  BankerNextBestActionUrgency,
  { pillBg: string; pillText: string; label: string }
> = {
  high: { pillBg: "bg-rose-100", pillText: "text-rose-900", label: "High urgency" },
  normal: { pillBg: "bg-sky-100", pillText: "text-sky-900", label: "Normal urgency" },
  low: { pillBg: "bg-stone-100", pillText: "text-stone-700", label: "Low urgency" },
};

export function BankerNextBestActionCard({
  action,
}: {
  action: BankerNextBestAction;
}) {
  const style = URGENCY_STYLES[action.urgency];

  return (
    <section
      role="region"
      aria-label="Banker next best action"
      className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-100">
          <Icon name="play_arrow" className="h-4 w-4 text-stone-700" />
        </div>
        <h3 className="text-sm font-semibold text-stone-900">Next best action</h3>
        <span
          className={cn(
            "ml-auto inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            style.pillBg,
            style.pillText,
          )}
          aria-label={style.label}
        >
          {style.label}
        </span>
      </div>

      <div className="mt-3">
        <div className="text-base font-semibold text-stone-950">{action.label}</div>
        <p className="mt-1 text-sm leading-6 text-stone-700">{action.rationale}</p>
      </div>

      {action.href && (
        <div className="mt-4">
          <a
            href={action.href}
            aria-label={action.label}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-stone-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
          >
            <Icon name="arrow_forward_ios" className="h-3.5 w-3.5 text-current" />
            Open
          </a>
        </div>
      )}
    </section>
  );
}
