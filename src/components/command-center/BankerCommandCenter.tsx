"use client";

import type { BankerCommandCenterViewModel } from "@/lib/banker/buildBankerCommandCenterViewModel";
import { BankerWorkloadSummaryCards } from "@/components/command-center/BankerWorkloadSummaryCards";
import { BankerOperationalQueueSection } from "@/components/command-center/BankerOperationalQueueSection";
import { BankerRecentlyActiveSection } from "@/components/command-center/BankerRecentlyActiveSection";

export function BankerCommandCenter({
  viewModel,
}: {
  viewModel: BankerCommandCenterViewModel;
}) {
  return (
    <section
      role="region"
      aria-label="Banker command center"
      className="space-y-4"
    >
      <header>
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/60">
          Banker command center
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          Operational overview
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-white/60">
          Operational continuity across active deals. Buddy organizes work
          by what is waiting on whom — not by lender approval likelihood.
        </p>
      </header>

      <BankerWorkloadSummaryCards summary={viewModel.summary} />

      {viewModel.sections.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/60">
          No active deals on the queue.
        </div>
      ) : (
        <div className="space-y-4">
          {viewModel.sections.map((section) => (
            <BankerOperationalQueueSection key={section.id} section={section} />
          ))}
        </div>
      )}

      <BankerRecentlyActiveSection items={viewModel.recentlyActive} />
    </section>
  );
}
