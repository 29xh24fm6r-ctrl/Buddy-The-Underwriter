"use client";

import type { BankerDealIntelligenceWorkspace } from "@/lib/banker/buildDealIntelligenceWorkspace";
import { BANKER_WORKSPACE_ANCHOR_IDS } from "@/lib/banker/buildDealIntelligenceWorkspace";
import { BankerDealWorkspaceHeader } from "@/components/banker/BankerDealWorkspaceHeader";
import { BankerWorkspaceNavigation } from "@/components/banker/BankerWorkspaceNavigation";
import { BorrowerOperationalContinuityPanel } from "@/components/banker/borrower-continuity/BorrowerOperationalContinuityPanel";
import { SubmissionOrchestrationWorkspace } from "@/components/submission-orchestration/SubmissionOrchestrationWorkspace";
import { LenderRoutingFitWorkspace } from "@/components/lender-routing/LenderRoutingFitWorkspace";

const FALLBACK_COPY =
  "Additional operational intelligence will appear as this package progresses.";

export function BankerDealWorkspace({
  workspace,
}: {
  workspace: BankerDealIntelligenceWorkspace;
}) {
  const { header, navigation, visibility, continuity, orchestration, routing } =
    workspace;

  const anyAdvancedVisible =
    visibility.continuity || visibility.orchestration || visibility.routing;

  return (
    <section
      role="region"
      aria-label="Banker deal workspace"
      className="space-y-4"
    >
      <div id={BANKER_WORKSPACE_ANCHOR_IDS.overview}>
        <BankerDealWorkspaceHeader header={header} />
      </div>

      <BankerWorkspaceNavigation items={navigation} />

      {!anyAdvancedVisible && (
        <div
          role="status"
          aria-label="Workspace fallback"
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/60 sm:p-6"
        >
          {FALLBACK_COPY}
        </div>
      )}

      {visibility.continuity && continuity && (
        <div id={BANKER_WORKSPACE_ANCHOR_IDS.overview} aria-label="Operational continuity section">
          <BorrowerOperationalContinuityPanel viewModel={continuity} />
        </div>
      )}

      {/*
        Submission preparation workspace (15Q) is intentionally omitted until
        the upstream VM exists. Visibility is preserved via the navigation flag
        for forward compatibility.
      */}

      {visibility.orchestration && orchestration && (
        <div
          id={BANKER_WORKSPACE_ANCHOR_IDS.orchestration}
          aria-label="Submission orchestration section"
        >
          <SubmissionOrchestrationWorkspace viewModel={orchestration} />
        </div>
      )}

      {visibility.routing && routing && (
        <div
          id={BANKER_WORKSPACE_ANCHOR_IDS.routing}
          aria-label="Lender routing fit section"
        >
          <LenderRoutingFitWorkspace viewModel={routing} />
        </div>
      )}
    </section>
  );
}
