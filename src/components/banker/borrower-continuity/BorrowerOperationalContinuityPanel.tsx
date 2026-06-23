"use client";

import type { BorrowerOperationalContinuityViewModel } from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
import { BankerIntakeBriefCard } from "@/components/banker/borrower-continuity/BankerIntakeBriefCard";
import { BankerNextBestActionCard } from "@/components/banker/borrower-continuity/BankerNextBestActionCard";
import { BorrowerMomentumSignalsCard } from "@/components/banker/borrower-continuity/BorrowerMomentumSignalsCard";
import { BankerContinuityCardsGrid } from "@/components/banker/borrower-continuity/BankerContinuityCardsGrid";
import { BankerOperationalTimelineSummary } from "@/components/banker/borrower-continuity/BankerOperationalTimelineSummary";

export function BorrowerOperationalContinuityPanel({
  viewModel,
}: {
  viewModel: BorrowerOperationalContinuityViewModel;
}) {
  return (
    <section
      role="region"
      aria-label="Borrower operational continuity"
      className="space-y-4"
    >
      <BankerIntakeBriefCard viewModel={viewModel} />

      <div className="grid gap-4 lg:grid-cols-2">
        <BankerNextBestActionCard action={viewModel.nextBestAction} />
        <BorrowerMomentumSignalsCard momentum={viewModel.momentum} />
      </div>

      <BankerContinuityCardsGrid cards={viewModel.cards} />

      <BankerOperationalTimelineSummary events={viewModel.recentEvents} />
    </section>
  );
}
