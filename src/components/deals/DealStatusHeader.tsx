"use client";

import type { DealMode } from "@/lib/deals/dealMode";

type DealStatusHeaderProps = {
  mode: DealMode;
  title?: string;
};

/**
 * DealStatusHeader
 *
 * Purpose:
 * - Single, calm, authoritative status header
 * - Replaces spinners, banners, alerts, and noisy indicators
 * - Human-readable truth of deal convergence
 */
export function DealStatusHeader({
  mode,
  title = "Deal status",
}: DealStatusHeaderProps) {
  const copy: Record<
    DealMode,
    { label: string; detail: string; tone: "neutral" | "warn" | "good" }
  > = {
    initializing: {
      label: "Initializing",
      detail: "We’re organizing your deal and preparing everything in the background.",
      tone: "neutral",
    },
    processing: {
      label: "Processing",
      detail: "Documents are being reviewed and matched automatically.",
      tone: "neutral",
    },
    needs_input: {
      label: "Action needed",
      detail: "A few required items are still missing.",
      tone: "warn",
    },
    ready: {
      label: "Ready",
      detail: "Everything is in place. You’re clear to proceed.",
      tone: "good",
    },
    blocked: {
      label: "Blocked",
      detail: "This deal needs attention before it can move forward.",
      tone: "warn",
    },
  };

  const current = copy[mode];

  const toneStyles =
    current.tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : current.tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-white text-slate-900";

  return (
    <div className={`rounded-lg border p-4 ${toneStyles}`}>
      <div className="text-xs uppercase tracking-wide opacity-70 mb-1">
        {title}
      </div>

      <div className="text-lg font-semibold">{current.label}</div>

      <div className="mt-1 text-sm opacity-80">{current.detail}</div>
    </div>
  );
}
