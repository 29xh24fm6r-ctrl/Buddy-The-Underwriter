"use client";

import { Icon } from "@/components/ui/Icon";

export function OwnerDailyBrief({
  bullets,
}: {
  bullets: string[];
}) {
  return (
    <section
      role="region"
      aria-label="Owner daily brief"
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="auto_awesome" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Owner daily brief</h3>
      </header>

      <ul
        className="mt-3 space-y-1 text-sm leading-6 text-white/80"
        role="list"
        aria-label="Daily brief bullets"
      >
        {bullets.map((bullet, i) => (
          <li key={i} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/40" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
