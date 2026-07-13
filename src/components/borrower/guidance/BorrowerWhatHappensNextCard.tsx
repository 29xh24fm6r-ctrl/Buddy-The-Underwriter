"use client";

import { Icon } from "@/components/ui/Icon";
import type { BorrowerGuidanceWhatHappensNext } from "@/lib/borrower/buildBorrowerGuidanceViewModel";

export function BorrowerWhatHappensNextCard({
  steps,
}: {
  steps: BorrowerGuidanceWhatHappensNext[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
          <Icon name="play_arrow" className="h-4 w-4 text-slate-600" />
        </div>
        <h3 className="font-heading text-sm font-semibold text-slate-900">
          What Happens Next
        </h3>
      </div>

      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
              {i + 1}
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">
                {step.title}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
