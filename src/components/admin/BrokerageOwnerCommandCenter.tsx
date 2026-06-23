"use client";

import type { BrokerageOwnerCommandCenterViewModel } from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";
import { BrokeragePipelineSummaryCards } from "@/components/admin/BrokeragePipelineSummaryCards";
import { BrokerageBottlenecksPanel } from "@/components/admin/BrokerageBottlenecksPanel";
import { BrokerageTeamWorkloadTable } from "@/components/admin/BrokerageTeamWorkloadTable";
import { ExecutiveAttentionQueue } from "@/components/admin/ExecutiveAttentionQueue";
import { SubmissionPipelineOverview } from "@/components/admin/SubmissionPipelineOverview";
import { BrokerageActivityFeed } from "@/components/admin/BrokerageActivityFeed";
import { OwnerDailyBrief } from "@/components/admin/OwnerDailyBrief";

export function BrokerageOwnerCommandCenter({
  viewModel,
}: {
  viewModel: BrokerageOwnerCommandCenterViewModel;
}) {
  return (
    <section
      role="region"
      aria-label="Brokerage owner command center"
      className="space-y-4"
    >
      <header>
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
          Brokerage owner command center
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          {viewModel.headline}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-white/60">{viewModel.summary}</p>
        <p className="mt-2 text-[11px] uppercase tracking-wider text-white/40">
          Operational visibility · not approval prediction
        </p>
      </header>

      <BrokeragePipelineSummaryCards pipeline={viewModel.pipeline} />

      <div className="grid gap-4 lg:grid-cols-2">
        <OwnerDailyBrief bullets={viewModel.dailyBrief} />
        <ExecutiveAttentionQueue items={viewModel.executiveAttention} />
      </div>

      <SubmissionPipelineOverview pipeline={viewModel.submissionPipeline} />

      <div className="grid gap-4 lg:grid-cols-2">
        <BrokerageBottlenecksPanel bottlenecks={viewModel.bottlenecks} />
        <BrokerageTeamWorkloadTable workload={viewModel.workload} />
      </div>

      <BrokerageActivityFeed activity={viewModel.activity} />
    </section>
  );
}
