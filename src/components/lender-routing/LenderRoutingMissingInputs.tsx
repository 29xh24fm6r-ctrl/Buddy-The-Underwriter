"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  LenderRoutingMissingInput,
  LenderRoutingMissingInputPriority,
} from "@/lib/banker/buildLenderRoutingFitViewModel";

const PRIORITY_STYLES: Record<
  LenderRoutingMissingInputPriority,
  { pillBg: string; pillText: string; label: string }
> = {
  required: { pillBg: "bg-rose-500/15 ring-1 ring-rose-400/30", pillText: "text-rose-200", label: "Required" },
  helpful: { pillBg: "bg-amber-500/15 ring-1 ring-amber-400/30", pillText: "text-amber-200", label: "Helpful" },
  optional: { pillBg: "bg-white/10 ring-1 ring-white/15", pillText: "text-stone-300", label: "Optional" },
};

export function LenderRoutingMissingInputs({
  items,
}: {
  items: LenderRoutingMissingInput[];
}) {
  return (
    <section
      role="region"
      aria-label="Missing routing inputs"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="fact_check" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Routing inputs needed</h3>
        <span className="ml-auto inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">
          {items.length}
        </span>
      </header>

      {items.length === 0 ? (
        <p className="mt-3 text-sm italic text-white/60">
          No routing inputs are currently missing.
        </p>
      ) : (
        <ul
          className="mt-3 space-y-2"
          role="list"
          aria-label="Missing routing inputs list"
        >
          {items.map((item) => {
            const style = PRIORITY_STYLES[item.priority];
            return (
              <li
                key={item.id}
                className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      style.pillBg,
                      style.pillText,
                    )}
                    aria-label={`Priority: ${style.label}`}
                  >
                    {style.label}
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {item.label}
                  </span>
                  {item.href && (
                    <a
                      href={item.href}
                      aria-label={`Collect ${item.label}`}
                      className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
                    >
                      Collect
                    </a>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-white/70">{item.reason}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
