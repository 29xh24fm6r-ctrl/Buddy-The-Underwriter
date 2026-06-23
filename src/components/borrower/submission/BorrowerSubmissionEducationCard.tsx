"use client";

import { Icon } from "@/components/ui/Icon";
import type { BorrowerSubmissionNextStep } from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";

export function BorrowerSubmissionEducationCard({
  steps,
}: {
  steps: BorrowerSubmissionNextStep[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-100">
          <Icon name="auto_awesome" className="h-4 w-4 text-sky-700" />
        </div>
        <h3 className="text-sm font-semibold text-stone-900">
          What happens before lender submission
        </h3>
      </div>

      <p className="mt-2 text-xs text-stone-600">
        Submission readiness reflects package preparation status, not a lending decision.
      </p>

      <ol className="mt-4 space-y-3">
        {steps.map((step, idx) => (
          <li key={idx} className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[11px] font-semibold text-stone-700">
              {idx + 1}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-stone-900">
                {step.headline}
              </div>
              <p className="mt-0.5 text-xs leading-5 text-stone-600">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
