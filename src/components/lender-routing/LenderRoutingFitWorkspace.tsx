"use client";

import type { LenderRoutingFitViewModel } from "@/lib/banker/buildLenderRoutingFitViewModel";
import { LenderRoutingHero } from "@/components/lender-routing/LenderRoutingHero";
import { LenderRoutingOptions } from "@/components/lender-routing/LenderRoutingOptions";
import { LenderRoutingMissingInputs } from "@/components/lender-routing/LenderRoutingMissingInputs";
import { LenderRoutingNextActionCard } from "@/components/lender-routing/LenderRoutingNextActionCard";

export function LenderRoutingFitWorkspace({
  viewModel,
}: {
  viewModel: LenderRoutingFitViewModel;
}) {
  return (
    <section
      role="region"
      aria-label="Lender routing & fit workspace"
      className="space-y-4"
    >
      <LenderRoutingHero viewModel={viewModel} />

      <div className="grid gap-4 lg:grid-cols-2">
        <LenderRoutingNextActionCard action={viewModel.nextAction} />
        <LenderRoutingMissingInputs items={viewModel.missingInputs} />
      </div>

      <LenderRoutingOptions options={viewModel.options} />
    </section>
  );
}
