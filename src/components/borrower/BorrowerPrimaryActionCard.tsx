"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export function BorrowerPrimaryActionCard({
  title,
  description,
  detail,
  ctaLabel,
  onClick,
  disabled,
  hint,
}: {
  title: string;
  description: string;
  detail?: string;
  ctaLabel: string;
  onClick?: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-[linear-gradient(135deg,_#fffdf8_0%,_#fff7ed_100%)] p-5 shadow-[0_14px_40px_rgba(120,53,15,0.08)] sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">
            <Icon name="auto_awesome" className="h-4 w-4 text-amber-700" />
            What Buddy needs next
          </div>
          <div>
            <h2 className="text-xl font-semibold text-stone-950 sm:text-2xl">
              {title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-700 sm:text-base">
              {description}
            </p>
            {detail ? (
              <p className="mt-2 text-sm leading-6 text-stone-600">{detail}</p>
            ) : null}
          </div>
        </div>

        <div className="w-full max-w-sm">
          <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
              "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2",
              disabled
                ? "cursor-not-allowed bg-stone-300 text-stone-600"
                : "bg-stone-950 text-white hover:bg-stone-800",
            )}
          >
            <Icon name="arrow_forward_ios" className="h-4 w-4 text-current" />
            {ctaLabel}
          </button>
          {hint ? <p className="mt-2 text-xs text-stone-500">{hint}</p> : null}
        </div>
      </div>
    </section>
  );
}
