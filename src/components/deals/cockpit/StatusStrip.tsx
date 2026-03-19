"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import { StatusChip } from "./StatusChip";
import { CoreDocumentsPanel } from "./panels/CoreDocumentsPanel";
import { YearAwareChecklistPanel } from "./panels/YearAwareChecklistPanel";
import { PipelinePanel } from "./panels/PipelinePanel";
import { ReadinessPanel } from "./panels/ReadinessPanel";
import { PrimaryCTAButton } from "./panels/PrimaryCTAButton";
import { useCockpitDataContext } from "@/buddy/cockpit";
import type { LifecycleState } from "@/buddy/lifecycle/client";

type StatusStripProps = {
  dealId: string;
  isAdmin?: boolean;
  gatekeeperPrimaryRouting?: boolean;
  unifiedLifecycleState?: LifecycleState | null;
  onAdvance?: () => void;
};

export function StatusStrip({ dealId, isAdmin = false, gatekeeperPrimaryRouting = false, unifiedLifecycleState, onAdvance }: StatusStripProps) {
  const { lifecycleState } = useCockpitDataContext();
  const state = lifecycleState ?? unifiedLifecycleState;
  const derived = state?.derived;

  const docPct = derived?.documentsReadinessPct ?? 0;
  const docStatus = docPct >= 100 ? "ok" : docPct > 0 ? "warn" : "neutral";
  const docSummary = docPct >= 100 ? "Complete \u2713" : `${Math.round(docPct)}%`;

  const checklistPct = (derived as Record<string, unknown> | undefined)?.checklistPct as number | null ?? null;
  const checklistStatus = checklistPct != null && checklistPct >= 100 ? "ok" : checklistPct != null && checklistPct > 0 ? "warn" : "neutral";
  const checklistSummary = checklistPct != null ? (checklistPct >= 100 ? "100% \u2713" : `${Math.round(checklistPct)}%`) : "\u2014";

  const snapshotReady = derived?.financialSnapshotExists ?? false;
  const pipelineStatus = snapshotReady ? "ok" : "neutral";
  const pipelineSummary = snapshotReady ? "Snapshot ready" : "Pending";

  const blockers = state?.blockers ?? [];
  const readinessStatus = blockers.length === 0 ? "ok" : "warn";
  const readinessSummary = blockers.length === 0
    ? (state?.stage ? state.stage.replace(/_/g, " ") : "Ready")
    : `${blockers.length} blocker${blockers.length !== 1 ? "s" : ""}`;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap relative">
        <SafeBoundary>
          <StatusChip icon="folder_open" label="Documents" summary={docSummary} status={docStatus} chipKey="docs" dealId={dealId}>
            <div className="p-4"><CoreDocumentsPanel dealId={dealId} gatekeeperPrimaryRouting={gatekeeperPrimaryRouting} /></div>
          </StatusChip>
        </SafeBoundary>
        <SafeBoundary>
          <StatusChip icon="checklist" label="Checklist" summary={checklistSummary} status={checklistStatus} chipKey="checklist" dealId={dealId}>
            <div className="p-4"><YearAwareChecklistPanel dealId={dealId} /></div>
          </StatusChip>
        </SafeBoundary>
        <SafeBoundary>
          <StatusChip icon="bolt" label="Pipeline" summary={pipelineSummary} status={pipelineStatus} chipKey="pipeline" dealId={dealId}>
            <div className="p-4"><PipelinePanel dealId={dealId} isAdmin={isAdmin} /></div>
          </StatusChip>
        </SafeBoundary>
        <SafeBoundary>
          <StatusChip icon="flag" label="Readiness" summary={readinessSummary} status={readinessStatus} chipKey="readiness" dealId={dealId}>
            <div className="p-4"><ReadinessPanel dealId={dealId} isAdmin={isAdmin} onAdvance={onAdvance} /></div>
          </StatusChip>
        </SafeBoundary>
        <div className="flex-1" />
        <SafeBoundary>
          <PrimaryCTAButton dealId={dealId} />
        </SafeBoundary>
      </div>
    </div>
  );
}
