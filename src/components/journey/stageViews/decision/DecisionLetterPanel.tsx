"use client";

import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { StatusListPanel } from "../_shared/StatusListPanel";
import type { DecisionLatest } from "./DecisionSummaryPanel";

/**
 * Decision letter / borrower-facing artifact panel.
 *
 * SPEC-05: receives decision data from DecisionStageView (shared with
 * DecisionSummaryPanel), reads attestation status from lifecycle context.
 */
export function DecisionLetterPanel({
  dealId,
  decision,
  loading = false,
  error = null,
}: {
  dealId: string;
  decision: DecisionLatest | null;
  loading?: boolean;
  error?: string | null;
}) {
  const { lifecycleState } = useCockpitDataContext();
  const attestationSatisfied = lifecycleState?.derived.attestationSatisfied ?? null;

  const snapshotId = decision?.snapshot?.id ?? null;
  const decisionLabel = decision?.snapshot?.decision ?? null;

  const status =
    attestationSatisfied === null
      ? "PENDING"
      : attestationSatisfied
        ? "ATTESTED"
        : "ATTESTATION REQUIRED";

  const tone =
    attestationSatisfied === true
      ? "success"
      : attestationSatisfied === false
        ? "warn"
        : "neutral";

  return (
    <StatusListPanel
      testId="decision-letter-panel"
      title="Decision Letter"
      icon="mail"
      badge={status}
      badgeTone={tone}
      summary={
        decisionLabel
          ? attestationSatisfied
            ? "Attestations complete. Borrower-facing decision artifact is ready to send."
            : "Decision is recorded but attestations are still required before sending the letter."
          : "Decision must be recorded before generating a borrower-facing letter."
      }
      loading={loading && !decision}
      error={error}
      rows={
        snapshotId
          ? [
              {
                id: "snapshot",
                label: "Decision snapshot",
                detail: snapshotId,
                tone: "neutral",
              },
            ]
          : []
      }
      emptyMessage="No decision snapshot available."
      links={[
        ...(snapshotId
          ? [
              {
                label: "Attest Decision",
                href: `/deals/${dealId}/decision/${snapshotId}/attest`,
              },
            ]
          : []),
        { label: "Audit Export", href: `/api/deals/${dealId}/decision/audit-export` },
        { label: "Decision Workspace", href: `/deals/${dealId}/decision` },
      ]}
    />
  );
}
