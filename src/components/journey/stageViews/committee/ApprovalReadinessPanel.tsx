"use client";

import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { blockerGatesStage } from "@/buddy/lifecycle/blockerToStage";
import { StatusListPanel, type StatusRow } from "../_shared/StatusListPanel";

/**
 * Approval readiness panel — pulls active blockers from lifecycle state and
 * lists the ones that gate `committee_ready` or `committee_decisioned`.
 */
export function ApprovalReadinessPanel({ dealId }: { dealId: string }) {
  const { lifecycleState } = useCockpitDataContext();
  const blockers = lifecycleState?.blockers ?? [];

  const approvalBlockers = blockers.filter((b) => {
    const gated = blockerGatesStage(b.code);
    return gated === "committee_ready" || gated === "committee_decisioned";
  });

  const rows: StatusRow[] = approvalBlockers.map((b) => ({
    id: b.code,
    label: b.message,
    detail: b.code,
    tone: "warn",
    badge: "BLOCKED",
  }));

  return (
    <StatusListPanel
      testId="committee-approval-readiness-panel"
      title="Approval Readiness"
      icon="how_to_reg"
      badge={
        approvalBlockers.length === 0 ? "READY" : `${approvalBlockers.length} BLOCKED`
      }
      badgeTone={approvalBlockers.length === 0 ? "success" : "warn"}
      summary={
        approvalBlockers.length === 0
          ? "Nothing blocks committee approval at this stage."
          : "Resolve these blockers before recording a decision."
      }
      rows={rows}
      emptyMessage="No approval blockers."
      links={[
        { label: "Lifecycle Status", href: `/deals/${dealId}/cockpit` },
        { label: "Decision", href: `/deals/${dealId}/decision` },
      ]}
    />
  );
}
