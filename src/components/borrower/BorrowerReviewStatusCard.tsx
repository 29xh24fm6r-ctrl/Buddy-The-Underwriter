"use client";

import { BorrowerChecklistStatusPill } from "@/components/borrower/BorrowerChecklistStatusPill";
import { Icon } from "@/components/ui/Icon";

export function BorrowerReviewStatusCard({
  title,
  summary,
  statusLabel,
  timing,
  nextStep,
}: {
  title: string;
  summary: string;
  statusLabel: string;
  timing: string;
  nextStep: string;
}) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(135deg,_#f0f7ff_0%,_#f6f8fb_100%)] p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
            <Icon name="pending" className="h-4 w-4 text-brand-blue-500" />
            Review transparency
          </div>
          <div>
            <h2 className="font-heading text-xl font-bold text-slate-900">{title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">{summary}</p>
          </div>
        </div>
        <BorrowerChecklistStatusPill label={statusLabel} tone="reviewing" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[1rem] border border-white/80 bg-white/90 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            What Buddy is doing
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">{timing}</p>
        </div>
        <div className="rounded-[1rem] border border-white/80 bg-white/90 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            What happens next
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">{nextStep}</p>
        </div>
      </div>
    </section>
  );
}
