"use client";

/**
 * SPEC-M2 BEAT-METRICS-1 — the five program "beat condition" metrics.
 * Renders "no data yet" honestly for any metric whose value is null
 * (pre-SPEC-M3/M5), rather than showing a misleading 0.
 */
import type { BeatConditionsSummary } from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";

type CardDef = {
  label: string;
  value: string;
  sample?: string;
};

function fmt(value: number | null, unit: string, digits = 1): string {
  if (value === null) return "No data yet";
  return `${value.toFixed(digits)}${unit}`;
}

export function BeatConditionsPanel({
  beatConditions,
}: {
  beatConditions?: BeatConditionsSummary;
}) {
  if (!beatConditions) return null;

  const cards: CardDef[] = [
    {
      label: "Time to first answer",
      value: fmt(beatConditions.avgTtfaMinutes, " min"),
      sample: `n=${beatConditions.ttfaDealCount}`,
    },
    {
      label: "Formless start rate",
      value: fmt(beatConditions.formlessStartRatePct, "%"),
      sample: `n=${beatConditions.formlessStartDealCount}`,
    },
    {
      label: "Deals with repeat asks",
      value: String(beatConditions.dealsWithRepeatAsks),
    },
    {
      label: "Avg. doc request rounds",
      value: fmt(beatConditions.avgDocRequestRounds, "", 2),
    },
    {
      label: "Avg. lender follow-ups",
      value: fmt(beatConditions.avgLenderFollowupCount, "", 2),
    },
  ];

  return (
    <section
      role="region"
      aria-label="Beat conditions"
      className="rounded-2xl border border-white/10 bg-white/5 p-4"
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
        Beat conditions
      </div>
      <p className="mt-1 text-[11px] text-white/40">
        Program metrics tracked against industry baselines — see docs/metrics/industry-baseline.md
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
              {card.label}
            </div>
            <div className="mt-1 text-xl font-semibold text-white">{card.value}</div>
            {card.sample && (
              <div className="mt-0.5 text-[10px] text-white/30">{card.sample}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
