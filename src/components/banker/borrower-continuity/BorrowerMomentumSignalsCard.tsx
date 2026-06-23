"use client";

import { Icon } from "@/components/ui/Icon";
import type { BorrowerMomentumSignals } from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";

export function BorrowerMomentumSignalsCard({
  momentum,
}: {
  momentum: BorrowerMomentumSignals;
}) {
  return (
    <section
      role="region"
      aria-label="Borrower momentum signals"
      className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-100">
          <Icon name="analytics" className="h-4 w-4 text-stone-700" />
        </div>
        <h3 className="text-sm font-semibold text-stone-900">Momentum signals</h3>
      </div>

      <dl
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"
        aria-label="Momentum counts"
      >
        <Stat label="Required received" value={momentum.requiredDocumentsReceived} tone="emerald" />
        <Stat label="Required remaining" value={momentum.requiredDocumentsRemaining} tone="sky" />
        <Stat label="Flagged for attention" value={momentum.needsAttentionCount} tone="amber" />
        <Stat label="Borrower action items" value={momentum.borrowerActionNeededCount} tone="stone" />
      </dl>

      <ul
        className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3"
        role="list"
        aria-label="State labels"
      >
        <LabelChip label="Waiting on" value={momentum.waitingOnLabel} />
        <LabelChip label="Submission readiness" value={momentum.submissionReadinessLabel} />
        <LabelChip label="Trust review" value={momentum.trustReviewLabel} />
      </ul>

      <p className="mt-4 text-xs text-stone-500">
        {momentum.recentActivityCount > 0
          ? `${momentum.recentActivityCount} recent borrower event${momentum.recentActivityCount === 1 ? "" : "s"} on file.`
          : "No recorded borrower activity yet."}
      </p>
    </section>
  );
}

const TONE_STYLES: Record<
  "emerald" | "sky" | "amber" | "stone",
  { border: string; bg: string; text: string }
> = {
  emerald: { border: "border-emerald-100", bg: "bg-emerald-50/40", text: "text-emerald-900" },
  sky: { border: "border-sky-100", bg: "bg-sky-50/40", text: "text-sky-900" },
  amber: { border: "border-amber-100", bg: "bg-amber-50/40", text: "text-amber-900" },
  stone: { border: "border-stone-100", bg: "bg-stone-50/60", text: "text-stone-900" },
};

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: keyof typeof TONE_STYLES;
}) {
  const style = TONE_STYLES[tone];
  return (
    <div className={`rounded-xl border p-3 ${style.border} ${style.bg}`}>
      <dt className={`text-[11px] font-semibold uppercase tracking-wider ${style.text}`}>
        {label}
      </dt>
      <dd className={`mt-1 text-2xl font-semibold ${style.text}`}>{value}</dd>
    </div>
  );
}

function LabelChip({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-stone-900">{value}</div>
    </li>
  );
}
