"use client";

import * as React from "react";
import { motion } from "framer-motion";
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
    <section className="relative overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)] sm:p-6">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(28,141,224,0.12),transparent_70%)]"
        aria-hidden="true"
      />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-blue-500">
            <Icon name="auto_awesome" className="h-4 w-4 text-brand-blue-500" />
            What Buddy needs next
          </div>
          <div>
            <h2 className="font-heading text-xl font-bold text-slate-900 sm:text-2xl">
              {title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              {description}
            </p>
            {detail ? (
              <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
            ) : null}
          </div>
        </div>

        <div className="w-full max-w-sm">
          <motion.button
            type="button"
            onClick={onClick}
            disabled={disabled}
            whileHover={disabled ? undefined : { scale: 1.02, y: -1 }}
            whileTap={disabled ? undefined : { scale: 0.98 }}
            className={cn(
              "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-brand-blue-500 focus:ring-offset-2",
              disabled
                ? "cursor-not-allowed bg-slate-300 text-slate-600"
                : "brand-gradient-cta hover:brightness-110",
            )}
          >
            {ctaLabel}
            <Icon name="arrow_forward_ios" className="h-4 w-4 text-current" />
          </motion.button>
          {hint ? <p className="mt-2 text-xs text-slate-500">{hint}</p> : null}
        </div>
      </div>
    </section>
  );
}
