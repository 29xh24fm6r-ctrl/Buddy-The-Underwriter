"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export function BorrowerProgressRail({
  progressLabel,
  progressValue,
  checklistSummary,
  timeline,
}: {
  progressLabel: string;
  progressValue: number;
  checklistSummary: string;
  timeline: Array<{
    id: string;
    title: string;
    subtitle: string;
    state: "done" | "current" | "upcoming";
  }>;
}) {
  return (
    <div className="space-y-4 xl:sticky xl:top-6">
      <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-stone-900">
              Your package progress
            </div>
            <div className="mt-1 text-sm text-stone-600">{progressLabel}</div>
          </div>
          <div className="rounded-full bg-stone-100 px-3 py-1 text-sm font-semibold text-stone-800">
            {progressValue}%
          </div>
        </div>
        <div
          className="mt-4 h-2.5 overflow-hidden rounded-full bg-stone-100"
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,_#b45309_0%,_#0f766e_100%)]"
            style={{ width: `${progressValue}%` }}
          />
        </div>
        <p className="mt-3 text-sm text-stone-600">{checklistSummary}</p>
      </section>

      <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-stone-900">What happens next</div>
        <ol className="mt-4 space-y-4">
          {timeline.map((step, index) => {
            const isDone = step.state === "done";
            const isCurrent = step.state === "current";
            return (
              <li key={step.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold",
                      isDone
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : isCurrent
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-stone-200 bg-stone-50 text-stone-500",
                    )}
                  >
                    {isDone ? (
                      <Icon name="check_circle" className="h-4 w-4 text-current" />
                    ) : (
                      index + 1
                    )}
                  </div>
                  {index < timeline.length - 1 ? (
                    <div className="mt-2 h-full min-h-6 w-px bg-stone-200" />
                  ) : null}
                </div>
                <div className="pb-2">
                  <div className="text-sm font-semibold text-stone-900">{step.title}</div>
                  <div className="mt-1 text-sm leading-6 text-stone-600">
                    {step.subtitle}
                  </div>
                  <div className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                    {isDone
                      ? "Completed"
                      : isCurrent
                        ? "In progress"
                        : "Coming up"}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
