"use client";

import type { SubmissionOrchestrationViewModel } from "@/lib/banker/buildSubmissionOrchestrationViewModel";
import { SubmissionOrchestrationHero } from "@/components/submission-orchestration/SubmissionOrchestrationHero";
import { SubmissionReadinessGates } from "@/components/submission-orchestration/SubmissionReadinessGates";
import { SubmissionPackageAssembly } from "@/components/submission-orchestration/SubmissionPackageAssembly";
import { SubmissionClarificationsPanel } from "@/components/submission-orchestration/SubmissionClarificationsPanel";
import { SubmissionOrchestrationNextActionCard } from "@/components/submission-orchestration/SubmissionOrchestrationNextActionCard";
import { SubmissionOrchestrationTimeline } from "@/components/submission-orchestration/SubmissionOrchestrationTimeline";

export function SubmissionOrchestrationWorkspace({
  viewModel,
}: {
  viewModel: SubmissionOrchestrationViewModel;
}) {
  return (
    <section
      role="region"
      aria-label="Submission orchestration workspace"
      className="space-y-4"
    >
      <SubmissionOrchestrationHero viewModel={viewModel} />

      <div className="grid gap-4 lg:grid-cols-2">
        <SubmissionOrchestrationNextActionCard action={viewModel.nextAction} />
        <SubmissionReadinessGates gates={viewModel.gates} />
      </div>

      <SubmissionPackageAssembly sections={viewModel.packageSections} />

      <SubmissionClarificationsPanel items={viewModel.clarifications} />

      <SubmissionOrchestrationTimeline events={viewModel.timeline} />
    </section>
  );
}
