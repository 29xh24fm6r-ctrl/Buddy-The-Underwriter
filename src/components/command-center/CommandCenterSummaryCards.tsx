"use client";

/**
 * Phase 65H — Command Center Summary Cards
 *
 * Shows critical metrics at a glance: critical, urgent, waiting on bank/borrower,
 * auto-advanced today, stale primary actions.
 */

import type { CommandCenterSummary } from "@/core/command-center/types";

type Props = {
  summary: CommandCenterSummary;
};

type CardDef = {
  label: string;
  value: number;
  tone: "danger" | "warn" | "info" | "success";
};

export default function CommandCenterSummaryCards({ summary }: Props) {
  const cards: CardDef[] = [
    { label: "Critical Now", value: summary.criticalCount, tone: "danger" },
    { label: "Urgent", value: summary.urgentCount, tone: "warn" },
    { label: "Waiting on Bank", value: summary.borrowerWaitingOnBankCount, tone: "warn" },
    { label: "Waiting on Borrower", value: summary.bankWaitingOnBorrowerCount, tone: "info" },
    { label: "Auto-Advanced Today", value: summary.autoAdvancedTodayCount, tone: "success" },
    { label: "Stale Actions", value: summary.stalePrimaryActionCount, tone: "warn" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="glass-card rounded-xl p-4 flex flex-col gap-1"
        >
          <span className="text-[11px] font-semibold text-white/50 uppercase tracking-wide">
            {card.label}
          </span>
          <span
            className={`text-2xl font-bold ${
              card.tone === "danger"
                ? "text-red-400"
                : card.tone === "warn"
                  ? "text-amber-400"
                  : card.tone === "success"
                    ? "text-emerald-400"
                    : "text-blue-400"
            }`}
          >
            {card.value}
          </span>
        </div>
      ))}
    </div>
  );
}
