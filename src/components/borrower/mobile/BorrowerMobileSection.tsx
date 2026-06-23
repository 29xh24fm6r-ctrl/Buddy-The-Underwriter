"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export function BorrowerMobileSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const buttonId = React.useId();
  const panelId = React.useId();

  return (
    <section
      className={cn(
        "rounded-[1.25rem] border border-stone-200 bg-white shadow-sm",
        className,
      )}
    >
      <button
        id={buttonId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 rounded-[1.25rem] px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stone-900">{title}</div>
          {subtitle && (
            <div className="mt-0.5 text-xs text-stone-600">{subtitle}</div>
          )}
        </div>
        <Icon
          name={open ? "chevron_left" : "chevron_right"}
          className="h-4 w-4 shrink-0 text-stone-500"
        />
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="border-t border-stone-100 px-4 py-3"
        >
          {children}
        </div>
      )}
    </section>
  );
}
