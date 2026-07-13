"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerGuidanceReassurance } from "@/lib/borrower/buildBorrowerGuidanceViewModel";

const TONE_STYLES: Record<
  BorrowerGuidanceReassurance["tone"],
  { border: string; bg: string; icon: "check_circle" | "pending" | "error"; iconColor: string }
> = {
  positive: {
    border: "border-emerald-200/60",
    bg: "bg-emerald-50/40",
    icon: "check_circle",
    iconColor: "text-emerald-600",
  },
  neutral: {
    border: "border-slate-200",
    bg: "bg-slate-50/40",
    icon: "pending",
    iconColor: "text-slate-500",
  },
  attention: {
    border: "border-amber-200/60",
    bg: "bg-amber-50/40",
    icon: "error",
    iconColor: "text-amber-600",
  },
};

export function BorrowerReassuranceCard({
  reassurance,
}: {
  reassurance: BorrowerGuidanceReassurance;
}) {
  const style = TONE_STYLES[reassurance.tone];

  return (
    <section
      className={cn(
        "rounded-[1.5rem] border p-5 shadow-sm",
        style.border,
        style.bg,
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/80">
          <Icon name={style.icon} className={cn("h-4 w-4", style.iconColor)} />
        </div>
        <h3 className="font-heading text-sm font-semibold text-slate-900">
          Package Status
        </h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">
        {reassurance.message}
      </p>
    </section>
  );
}
