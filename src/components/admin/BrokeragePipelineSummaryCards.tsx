"use client";

import type { BrokeragePipelineSummary } from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";

type CardDef = {
  label: string;
  value: number;
  tone: "danger" | "warn" | "info" | "ok" | "neutral";
  optional?: boolean;
};

const TONE_STYLES: Record<CardDef["tone"], { ring: string; valueColor: string }> = {
  danger: { ring: "ring-rose-400/30", valueColor: "text-rose-200" },
  warn: { ring: "ring-amber-400/30", valueColor: "text-amber-200" },
  info: { ring: "ring-sky-400/30", valueColor: "text-sky-200" },
  ok: { ring: "ring-emerald-400/30", valueColor: "text-emerald-200" },
  neutral: { ring: "ring-white/15", valueColor: "text-white" },
};

export function BrokeragePipelineSummaryCards({
  pipeline,
}: {
  pipeline: BrokeragePipelineSummary;
}) {
  const cards: CardDef[] = [
    { label: "Active deals", value: pipeline.activeDeals, tone: "neutral" },
    {
      label: "Banker action required",
      value: pipeline.bankerActionRequired,
      tone: pipeline.bankerActionRequired > 0 ? "danger" : "ok",
    },
    {
      label: "Borrower action required",
      value: pipeline.borrowerActionRequired,
      tone: pipeline.borrowerActionRequired > 0 ? "info" : "neutral",
    },
    {
      label: "Submission-prep ready",
      value: pipeline.submissionPrepReady,
      tone: pipeline.submissionPrepReady > 0 ? "ok" : "neutral",
    },
    {
      label: "Routing review ready",
      value: pipeline.routingReviewReady,
      tone: pipeline.routingReviewReady > 0 ? "ok" : "neutral",
    },
    {
      label: "Open clarifications",
      value: pipeline.unresolvedClarifications,
      tone: pipeline.unresolvedClarifications > 0 ? "warn" : "neutral",
    },
    {
      label: "Stalled deals",
      value: pipeline.stalledDeals,
      tone: pipeline.stalledDeals > 0 ? "warn" : "neutral",
    },
    {
      label: "Recently active",
      value: pipeline.recentlyActiveDeals,
      tone: pipeline.recentlyActiveDeals > 0 ? "ok" : "neutral",
    },
  ];

  if (typeof pipeline.submittedDeals === "number") {
    cards.push({
      label: "Submitted",
      value: pipeline.submittedDeals,
      tone: "ok",
      optional: true,
    });
  }
  if (typeof pipeline.fundedDeals === "number") {
    cards.push({
      label: "Funded",
      value: pipeline.fundedDeals,
      tone: "ok",
      optional: true,
    });
  }

  return (
    <section
      role="region"
      aria-label="Brokerage pipeline summary"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
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
