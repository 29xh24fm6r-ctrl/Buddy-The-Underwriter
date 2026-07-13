"use client";

import { Icon } from "@/components/ui/Icon";
import type { BorrowerDocumentPackageSummary as PackageSummary } from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";

export function BorrowerDocumentPackageSummary({
  summary,
}: {
  summary: PackageSummary;
}) {
  const completionPct =
    summary.requiredTotal > 0
      ? Math.round((summary.requiredReceived / summary.requiredTotal) * 100)
      : 0;

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
          <Icon name="checklist" className="h-4 w-4 text-slate-700" />
        </div>
        <h3 className="font-heading text-sm font-semibold text-slate-900">
          Document package
        </h3>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-700">{summary.summary}</p>

      {summary.requiredTotal > 0 && (
        <div className="mt-4">
          <div
            className="h-2 overflow-hidden rounded-full bg-slate-100"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-700"
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
            <span>
              {summary.requiredReceived} of {summary.requiredTotal} required item
              {summary.requiredTotal === 1 ? "" : "s"} received
            </span>
            <span className="font-semibold text-slate-900">{completionPct}%</span>
          </div>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Required remaining" value={summary.requiredRemaining} />
        <Stat label="Optional received" value={summary.optionalReceived} />
        <Stat
          label="Needs attention"
          value={summary.needsAttention}
          tone={summary.needsAttention > 0 ? "attention" : "default"}
        />
        <Stat label="Required received" value={summary.requiredReceived} />
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "attention";
}) {
  const valueClass =
    tone === "attention" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className={`mt-0.5 text-base font-semibold ${valueClass}`}>{value}</dd>
    </div>
  );
}
