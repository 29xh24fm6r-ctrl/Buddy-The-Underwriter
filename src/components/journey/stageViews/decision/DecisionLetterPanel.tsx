"use client";

import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { StatusListPanel, useJsonFetch } from "../_shared/StatusListPanel";

type DecisionApi = {
  ok?: boolean;
  snapshot?: {
    id?: string;
    decision?: string | null;
    created_at?: string | null;
  } | null;
};

/**
 * Decision letter / borrower-facing artifact panel.
 *
 * Surfaces attestation status (from lifecycle.derived.attestationSatisfied)
 * and exposes deep-links to the attestation flow + audit export. The actual
 * letter generation lives on the decision route surface.
 */
export function DecisionLetterPanel({ dealId }: { dealId: string }) {
  const { lifecycleState } = useCockpitDataContext();
  const attestationSatisfied = lifecycleState?.derived.attestationSatisfied ?? null;

  const { data, loading, error } = useJsonFetch<DecisionApi>(
    `/api/deals/${dealId}/decision/latest`,
  );
  const snapshotId = data?.snapshot?.id ?? null;
  const decision = data?.snapshot?.decision ?? null;

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
        decision
          ? attestationSatisfied
            ? "Attestations complete. Borrower-facing decision artifact is ready to send."
            : "Decision is recorded but attestations are still required before sending the letter."
          : "Decision must be recorded before generating a borrower-facing letter."
      }
      loading={loading && !data}
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
