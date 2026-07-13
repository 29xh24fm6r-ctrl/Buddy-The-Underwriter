"use client";

import { Icon } from "@/components/ui/Icon";
import type { BorrowerCommunicationViewModel } from "@/lib/borrower/buildBorrowerCommunicationViewModel";
import { BorrowerActionNeededBanner } from "./BorrowerActionNeededBanner";
import { BorrowerRecentUpdatesTimeline } from "./BorrowerRecentUpdatesTimeline";
import { BorrowerResponseNeededCard } from "./BorrowerResponseNeededCard";
import { BorrowerWaitingOnStatus } from "./BorrowerWaitingOnStatus";
import { BorrowerNoActionReassurance } from "./BorrowerNoActionReassurance";

export function BorrowerCommunicationCenter({
  viewModel,
}: {
  viewModel: BorrowerCommunicationViewModel;
}) {
  const isAction =
    viewModel.state === "action_needed" || viewModel.state === "blocked";
  const isNoAction = viewModel.state === "no_action_needed";

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-[linear-gradient(135deg,_rgba(248,250,252,0.8)_0%,_rgba(241,245,249,0.4)_100%)] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white shadow-sm">
              <Icon name="auto_awesome" className="h-5 w-5 text-brand-blue-500" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Messages &amp; Updates
            </span>
          </div>
          <BorrowerWaitingOnStatus
            waitingOn={viewModel.waitingOn}
            label={viewModel.waitingOnLabel}
          />
        </div>

        <div className="mt-4 space-y-2">
          <h2 className="font-heading font-bold text-2xl leading-tight text-slate-900 sm:text-3xl">
            {viewModel.headline}
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-slate-700 sm:text-base">
            {viewModel.summary}
          </p>
        </div>
      </section>

      {isAction && (
        <BorrowerActionNeededBanner
          state={viewModel.state}
          count={viewModel.actionNeededCount}
          primaryCtaLabel={viewModel.primaryCtaLabel}
          primaryCtaHref={viewModel.primaryCtaHref}
          topItems={viewModel.responseNeededItems}
        />
      )}

      {viewModel.responseNeededItems.length > 0 && (
        <BorrowerResponseNeededCard items={viewModel.responseNeededItems} />
      )}

      {isNoAction && viewModel.reassuranceMessage && (
        <BorrowerNoActionReassurance message={viewModel.reassuranceMessage} />
      )}

      <BorrowerRecentUpdatesTimeline updates={viewModel.recentUpdates} />
    </div>
  );
}
