"use client";

import { motion } from "framer-motion";
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
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-heading text-sm font-semibold text-slate-900">
              Your package progress
            </div>
            <div className="mt-1 text-sm text-slate-600">{progressLabel}</div>
          </div>
          <div className="brand-gradient-cta rounded-full px-3 py-1 text-sm font-bold text-white">
            {progressValue}%
          </div>
        </div>
        <div
          className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100"
          aria-hidden="true"
        >
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#1c8de0] to-[#4db8f0]"
            initial={{ width: 0 }}
            animate={{ width: `${progressValue}%` }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
        </div>
        <p className="mt-3 text-sm text-slate-600">{checklistSummary}</p>
      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="font-heading text-sm font-semibold text-slate-900">What happens next</div>
        <ol className="mt-4 space-y-4">
          {timeline.map((step, index) => {
            const isDone = step.state === "done";
            const isCurrent = step.state === "current";
            return (
              <li key={step.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition",
                      isDone
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                        : isCurrent
                          ? "brand-gradient-cta text-white ring-2 ring-brand-blue-500/30 ring-offset-2"
                          : "border border-slate-200 bg-slate-50 text-slate-400",
                    )}
                  >
                    {isDone ? (
                      <Icon name="check_circle" className="h-4 w-4 text-current" />
                    ) : (
                      index + 1
                    )}
                  </div>
                  {index < timeline.length - 1 ? (
                    <div className="mt-2 h-full min-h-6 w-px bg-slate-200" />
                  ) : null}
                </div>
                <div className="pb-2">
                  <div className="text-sm font-semibold text-slate-900">{step.title}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">
                    {step.subtitle}
                  </div>
                  <div
                    className={cn(
                      "mt-2 text-xs font-semibold uppercase tracking-[0.18em]",
                      isDone
                        ? "text-emerald-600"
                        : isCurrent
                          ? "text-brand-blue-500"
                          : "text-slate-400",
                    )}
                  >
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
