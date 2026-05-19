"use client";

import { BorrowerProgressStep } from "@/components/borrower/BorrowerProgressStep";

export function BorrowerProgressTimeline({
  title,
  summary,
  steps,
}: {
  title: string;
  summary: string;
  steps: Array<{ key: string; title: string; detail: string; state: "done" | "current" | "upcoming" }>;
}) {
  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        Package progress
      </div>
      <h2 className="mt-2 text-xl font-semibold text-stone-950">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">{summary}</p>
      <ol className="mt-5 space-y-4">
        {steps.map((step, index) => (
          <BorrowerProgressStep
            key={step.key}
            title={step.title}
            detail={step.detail}
            state={step.state}
            index={index}
            showConnector={index < steps.length - 1}
          />
        ))}
      </ol>
    </section>
  );
}
