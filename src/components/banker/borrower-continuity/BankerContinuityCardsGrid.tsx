"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BankerContinuityCard,
  BankerContinuityCardStatus,
} from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
import { BANKER_CONTINUITY_CARD_STATUS_LABELS } from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";

const STATUS_STYLES: Record<
  BankerContinuityCardStatus,
  { dot: string; pillBg: string; pillText: string }
> = {
  strong: { dot: "bg-emerald-600", pillBg: "bg-emerald-100", pillText: "text-emerald-900" },
  progressing: { dot: "bg-sky-500", pillBg: "bg-sky-100", pillText: "text-sky-900" },
  needs_attention: {
    dot: "bg-amber-500",
    pillBg: "bg-amber-100",
    pillText: "text-amber-900",
  },
  blocked: { dot: "bg-rose-500", pillBg: "bg-rose-100", pillText: "text-rose-900" },
  waiting: { dot: "bg-amber-400", pillBg: "bg-amber-100", pillText: "text-amber-900" },
  ready: { dot: "bg-emerald-500", pillBg: "bg-emerald-100", pillText: "text-emerald-900" },
  unavailable: {
    dot: "bg-stone-300",
    pillBg: "bg-stone-100",
    pillText: "text-stone-700",
  },
};

export function BankerContinuityCardsGrid({
  cards,
}: {
  cards: BankerContinuityCard[];
}) {
  if (cards.length === 0) return null;

  return (
    <section
      role="region"
      aria-label="Banker continuity cards"
      className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-100">
          <Icon name="checklist" className="h-4 w-4 text-stone-700" />
        </div>
        <h3 className="text-sm font-semibold text-stone-900">Continuity overview</h3>
      </div>

      <ul
        className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        role="list"
        aria-label="Continuity cards"
      >
        {cards.map((card) => {
          const style = STATUS_STYLES[card.status];
          const statusLabel = BANKER_CONTINUITY_CARD_STATUS_LABELS[card.status];
          return (
            <li
              key={card.id}
              className="rounded-xl border border-stone-100 bg-stone-50/40 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn("h-2 w-2 rounded-full", style.dot)}
                  aria-hidden="true"
                />
                <h4 className="text-sm font-semibold text-stone-900">{card.title}</h4>
                <span
                  className={cn(
                    "ml-auto inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    style.pillBg,
                    style.pillText,
                  )}
                  aria-label={statusLabel}
                >
                  {statusLabel}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-stone-700">{card.summary}</p>
              {typeof card.count === "number" && card.count > 0 && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-semibold text-stone-800">
                  Count: {card.count}
                </div>
              )}
              {card.href && card.ctaLabel && (
                <div className="mt-3">
                  <a
                    href={card.href}
                    aria-label={card.ctaLabel}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                  >
                    {card.ctaLabel}
                  </a>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
