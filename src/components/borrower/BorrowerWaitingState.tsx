"use client";

import { Icon } from "@/components/ui/Icon";

export function BorrowerWaitingState({
  title,
  summary,
  expectation,
}: {
  title: string;
  summary: string;
  expectation: string;
}) {
  return (
    <section className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50/70 p-5 shadow-sm sm:p-6">
      <div className="flex gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white">
          <Icon name="check_circle" className="h-5 w-5 text-emerald-700" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-emerald-950">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-emerald-900">{summary}</p>
          <p className="mt-3 text-sm leading-6 text-emerald-900/90">{expectation}</p>
        </div>
      </div>
    </section>
  );
}
