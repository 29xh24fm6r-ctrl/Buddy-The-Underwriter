"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerReadinessScore } from "@/lib/borrower/buildBorrowerReadinessViewModel";
import { BorrowerReadinessRing } from "./BorrowerReadinessRing";

const BAND_LABELS: Record<BorrowerReadinessScore["band"], string> = {
  early_stage: "Early Stage",
  progressing: "Progressing",
  strong_progress: "Strong Progress",
  near_submission_ready: "Near Submission Ready",
};

const BAND_BADGE_STYLES: Record<BorrowerReadinessScore["band"], string> = {
  early_stage: "bg-slate-100 text-slate-700",
  progressing: "bg-amber-100 text-amber-900",
  strong_progress: "bg-teal-100 text-teal-900",
  near_submission_ready: "bg-emerald-100 text-emerald-900",
};

const BAND_PANEL_STYLES: Record<BorrowerReadinessScore["band"], string> = {
  early_stage: "border-slate-200/70 bg-slate-50/60",
  progressing: "border-amber-200/70 bg-amber-50/40",
  strong_progress: "border-teal-200/70 bg-teal-50/40",
  near_submission_ready: "border-emerald-200/70 bg-emerald-50/40",
};

export function BorrowerReadinessHero({
  readiness,
  dealName,
}: {
  readiness: BorrowerReadinessScore;
  dealName?: string | null;
}) {
  const hasDelta = readiness.delta != null && readiness.delta !== 0;
  const deltaPositive = (readiness.delta ?? 0) > 0;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[1.75rem] border p-5 sm:p-7",
        BAND_PANEL_STYLES[readiness.band],
      )}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Funding Readiness
            </span>
            <span
              className={cn(
                "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
                BAND_BADGE_STYLES[readiness.band],
              )}
            >
              {BAND_LABELS[readiness.band]}
            </span>
            {hasDelta && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  deltaPositive
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-slate-100 text-slate-600",
                )}
              >
                {deltaPositive ? "+" : ""}
                {readiness.delta}%
              </span>
            )}
          </div>

          {dealName && (
            <div className="text-xs font-medium text-slate-500">{dealName}</div>
          )}

          <p className="max-w-xl text-sm leading-6 text-slate-700 sm:text-base">
            {readiness.summary}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2">
          <BorrowerReadinessRing
            score={readiness.score}
            band={readiness.band}
            size="lg"
          />
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Readiness
          </div>
        </div>
      </div>
    </section>
  );
}
