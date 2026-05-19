"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerGuidanceViewModel } from "@/lib/borrower/buildBorrowerGuidanceViewModel";
import { BorrowerCoachedItemsCard } from "./BorrowerCoachedItemsCard";
import { BorrowerWhatHappensNextCard } from "./BorrowerWhatHappensNextCard";
import { BorrowerReassuranceCard } from "./BorrowerReassuranceCard";

export function BorrowerGuidancePanel({
  viewModel,
}: {
  viewModel: BorrowerGuidanceViewModel;
}) {
  const { nextStep } = viewModel;
  const hasAction = nextStep.ctaLabel && nextStep.href;

  return (
    <div className="space-y-4">
      {/* Primary guidance hero */}
      <section className="overflow-hidden rounded-[1.75rem] border border-sky-200/60 bg-[linear-gradient(135deg,_rgba(224,242,254,0.5)_0%,_rgba(240,249,255,0.3)_100%)] p-5 sm:p-7">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/90 shadow-sm">
            <Icon name="auto_awesome" className="h-5 w-5 text-sky-700" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
            Guidance from Buddy
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <h2 className="font-serif text-2xl leading-tight text-stone-950 sm:text-3xl">
            {viewModel.headline}
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-stone-700 sm:text-base">
            {viewModel.summary}
          </p>
        </div>

        {/* Next step CTA */}
        <div className="mt-5 rounded-2xl border border-white/80 bg-white/70 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Next recommended step
          </div>
          <div className="mt-2 text-sm font-semibold text-stone-900">
            {nextStep.headline}
          </div>
          <p className="mt-1 text-sm text-stone-600">
            {nextStep.description}
          </p>
          {hasAction && (
            <a
              href={nextStep.href}
              className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-stone-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
            >
              <Icon name="arrow_forward_ios" className="h-3.5 w-3.5 text-current" />
              {nextStep.ctaLabel}
            </a>
          )}
        </div>
      </section>

      {/* Coached items */}
      {viewModel.coachedItems.length > 0 && (
        <BorrowerCoachedItemsCard items={viewModel.coachedItems} />
      )}

      {/* What happens next + Reassurance side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <BorrowerWhatHappensNextCard steps={viewModel.whatHappensNext} />
        <BorrowerReassuranceCard reassurance={viewModel.reassurance} />
      </div>
    </div>
  );
}
