"use client";

import type { BankerCommandCenterWorkloadSummary } from "@/lib/banker/buildBankerCommandCenterViewModel";

type CardDef = {
  label: string;
  value: number;
  tone: "danger" | "warn" | "info" | "ok" | "neutral";
  hint?: string;
};

const TONE_STYLES: Record<CardDef["tone"], { ring: string; valueColor: string }> = {
  danger: { ring: "ring-rose-400/30", valueColor: "text-rose-200" },
  warn: { ring: "ring-amber-400/30", valueColor: "text-amber-200" },
  info: { ring: "ring-sky-400/30", valueColor: "text-sky-200" },
  ok: { ring: "ring-emerald-400/30", valueColor: "text-emerald-200" },
  neutral: { ring: "ring-white/15", valueColor: "text-white" },
};

export function BankerWorkloadSummaryCards({
  summary,
}: {
  summary: BankerCommandCenterWorkloadSummary;
}) {
  const cards: CardDef[] = [
    {
      label: "Banker action",
      value: summary.bankerActionRequired,
      tone: summary.bankerActionRequired > 0 ? "danger" : "ok",
    },
    {
      label: "Borrower action",
      value: summary.borrowerActionRequired,
      tone: summary.borrowerActionRequired > 0 ? "info" : "neutral",
    },
    {
      label: "Ready for submission prep",
      value: summary.readyForSubmissionPrep,
      tone: summary.readyForSubmissionPrep > 0 ? "ok" : "neutral",
    },
    {
      label: "Stalled deals",
      value: summary.stalledDeals,
      tone: summary.stalledDeals > 0 ? "warn" : "neutral",
    },
    {
      label: "Operationally blocked",
      value: summary.operationallyBlocked,
      tone: summary.operationallyBlocked > 0 ? "danger" : "neutral",
    },
    {
      label: "Open attention items",
      value: summary.unresolvedAttentionItems,
      tone: summary.unresolvedAttentionItems > 0 ? "warn" : "neutral",
    },
  ];

  return (
    <section
      role="region"
      aria-label="Banker workload summary"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"
    >
      {cards.map((card) => {
        const style = TONE_STYLES[card.tone];
        return (
          <div
            key={card.label}
            className={`rounded-2xl border border-white/10 bg-white/5 p-4 ring-1 ${style.ring}`}
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
              {card.label}
            </div>
            <div className={`mt-1 text-2xl font-semibold ${style.valueColor}`}>
              {card.value}
            </div>
          </div>
        );
      })}
    </section>
  );
}
