"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BorrowerTrustReviewViewModel,
  BorrowerTrustReviewState,
} from "@/lib/borrower/buildBorrowerTrustReviewViewModel";
import { BORROWER_TRUST_REVIEW_STATE_LABELS } from "@/lib/borrower/buildBorrowerTrustReviewViewModel";
import { BorrowerReviewGroupCard } from "@/components/borrower/trust-review/BorrowerReviewGroupCard";
import { BorrowerConfirmationItems } from "@/components/borrower/trust-review/BorrowerConfirmationItems";
import { BorrowerPackageReviewSummary } from "@/components/borrower/trust-review/BorrowerPackageReviewSummary";
import { BorrowerTrustCaveatCard } from "@/components/borrower/trust-review/BorrowerTrustCaveatCard";

const STATE_STYLES: Record<
  BorrowerTrustReviewState,
  { border: string; bg: string; dot: string; badge: string; badgeBg: string }
> = {
  not_ready_to_review: {
    border: "border-slate-200",
    bg: "bg-slate-50/60",
    dot: "bg-slate-400",
    badge: "text-slate-800",
    badgeBg: "bg-slate-100",
  },
  ready_to_review: {
    border: "border-sky-200/70",
    bg: "bg-sky-50/30",
    dot: "bg-sky-500",
    badge: "text-sky-900",
    badgeBg: "bg-sky-100",
  },
  confirmations_needed: {
    border: "border-amber-200/70",
    bg: "bg-amber-50/40",
    dot: "bg-amber-500",
    badge: "text-amber-900",
    badgeBg: "bg-amber-100",
  },
  reviewed: {
    border: "border-emerald-200/70",
    bg: "bg-emerald-50/40",
    dot: "bg-emerald-500",
    badge: "text-emerald-900",
    badgeBg: "bg-emerald-100",
  },
  waiting_on_updates: {
    border: "border-slate-300",
    bg: "bg-slate-50/70",
    dot: "bg-slate-500",
    badge: "text-slate-900",
    badgeBg: "bg-slate-100",
  },
};

export function BorrowerTrustReviewCenter({
  viewModel,
}: {
  viewModel: BorrowerTrustReviewViewModel;
}) {
  const style = STATE_STYLES[viewModel.state];
  const stateLabel = BORROWER_TRUST_REVIEW_STATE_LABELS[viewModel.state];

  return (
    <section
      role="region"
      aria-label="Review Your Package"
      className="space-y-4"
    >
      <header
        className={cn(
          "overflow-hidden rounded-[1.75rem] border p-5 shadow-sm sm:p-7",
          style.border,
          style.bg,
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn("h-2 w-2 rounded-full", style.dot)}
            aria-hidden="true"
          />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600">
            Review Your Package
          </span>
          <span
            className={cn(
              "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              style.badgeBg,
              style.badge,
            )}
            aria-label={stateLabel}
          >
            {stateLabel}
          </span>
        </div>

        <h2 className="mt-4 font-heading font-bold text-2xl leading-tight text-slate-900 sm:text-3xl">
          {viewModel.headline}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700 sm:text-base">
          {viewModel.summary}
        </p>

        {viewModel.primaryCtaHref && viewModel.primaryCtaLabel && (
          <div className="mt-5">
            <a
              href={viewModel.primaryCtaHref}
              aria-label={viewModel.primaryCtaLabel}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl brand-gradient-cta px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue-500 focus-visible:ring-offset-2"
            >
              <Icon name="edit" className="h-4 w-4 text-current" />
              {viewModel.primaryCtaLabel}
            </a>
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {viewModel.reviewGroups.map((group) => (
          <BorrowerReviewGroupCard key={group.id} group={group} />
        ))}
      </div>

      <BorrowerConfirmationItems items={viewModel.confirmationItems} />

      <BorrowerPackageReviewSummary summary={viewModel.packageSummary} />

      <BorrowerTrustCaveatCard message={viewModel.caveatMessage} />
    </section>
  );
}
