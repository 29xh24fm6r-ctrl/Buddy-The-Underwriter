"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export function BorrowerProgressStep({
  title,
  detail,
  state,
  index,
  showConnector,
}: {
  title: string;
  detail: string;
  state: "done" | "current" | "upcoming";
  index: number;
  showConnector: boolean;
}) {
  const circleClass =
    state === "done"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : state === "current"
        ? "brand-gradient-cta border-transparent text-white"
        : "border-slate-200 bg-slate-50 text-slate-400";

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold",
            circleClass,
          )}
        >
          {state === "done" ? (
            <Icon name="check_circle" className="h-4 w-4 text-current" />
          ) : (
            index + 1
          )}
        </div>
        {showConnector ? <div className="mt-2 h-full min-h-6 w-px bg-slate-200" /> : null}
      </div>
      <div className="pb-2">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="mt-1 text-sm leading-6 text-slate-600">{detail}</div>
        <div className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
          {state === "done" ? "Completed" : state === "current" ? "Current stage" : "Coming up"}
        </div>
      </div>
    </li>
  );
}
