"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerMobileCommandViewModel } from "@/lib/borrower/buildBorrowerMobileCommandViewModel";

const STATE_STYLES: Record<
  BorrowerMobileCommandViewModel["state"],
  { eyebrowText: string; border: string; bg: string; dot: string }
> = {
  blocked: {
    eyebrowText: "Today’s focus",
    border: "border-rose-200/70",
    bg: "bg-rose-50/40",
    dot: "bg-rose-500",
  },
  action_needed: {
    eyebrowText: "Today’s focus",
    border: "border-amber-200/70",
    bg: "bg-amber-50/40",
    dot: "bg-amber-500",
  },
  waiting: {
    eyebrowText: "Today’s focus",
    border: "border-sky-200/70",
    bg: "bg-sky-50/40",
    dot: "bg-sky-500",
  },
  in_progress: {
    eyebrowText: "Today’s focus",
    border: "border-stone-200",
    bg: "bg-stone-50/60",
    dot: "bg-stone-500",
  },
  no_action_needed: {
    eyebrowText: "Today’s focus",
    border: "border-emerald-200/70",
    bg: "bg-emerald-50/40",
    dot: "bg-emerald-500",
  },
};

export function BorrowerMobileCommandCenter({
  viewModel,
}: {
  viewModel: BorrowerMobileCommandViewModel;
}) {
  const style = STATE_STYLES[viewModel.state];
  const hasCta = Boolean(viewModel.primaryCtaLabel && viewModel.primaryCtaHref);

  return (
    <section
      role="region"
      aria-label="Today’s focus"
      className={cn(
        "rounded-[1.5rem] border p-5 shadow-sm sm:p-6",
        style.border,
        style.bg,
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn("h-2 w-2 rounded-full", style.dot)}
          aria-hidden="true"
        />
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-600">
          {style.eyebrowText}
        </span>
      </div>

      <h2 className="mt-3 font-serif text-2xl leading-tight text-stone-950 sm:text-3xl">
        {viewModel.headline}
      </h2>
      <p className="mt-2 text-sm leading-6 text-stone-700">{viewModel.summary}</p>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Progress" value={viewModel.progressLabel} />
        {viewModel.readinessLabel && (
          <Stat label="Readiness" value={viewModel.readinessLabel} />
        )}
        {viewModel.waitingOnLabel && (
          <Stat label="Waiting on" value={viewModel.waitingOnLabel} />
        )}
      </dl>

      {viewModel.priorityItems.length > 0 && (
        <ul className="mt-4 space-y-2">
          {viewModel.priorityItems.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-2 rounded-xl border border-white/80 bg-white/80 px-3 py-2"
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-700" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-stone-900">
                  {item.label}
                </div>
                {item.description && (
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-stone-600">
                    {item.description}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {hasCta && (
        <a
          href={viewModel.primaryCtaHref}
          aria-label={viewModel.primaryCtaLabel}
          className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        >
          <Icon name="arrow_forward_ios" className="h-3.5 w-3.5 text-current" />
          {viewModel.primaryCtaLabel}
        </a>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/80 bg-white/70 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-stone-900">{value}</dd>
    </div>
  );
}
