"use client";

import { StatusListPanel, useJsonFetch } from "../_shared/StatusListPanel";

type MemoMissingApi = {
  ok?: boolean;
  required_keys?: string[];
  present_keys?: string[];
  missing_keys?: string[];
};

/**
 * Inline credit memo summary for the committee stage.
 *
 * Pulls from the canonical-memo /missing endpoint to derive a coarse memo
 * readiness indicator without re-rendering the full memo here. Detailed
 * gap-by-gap reconciliation lives in MemoReconciliationPanel.
 */
export function CreditMemoPanel({ dealId }: { dealId: string }) {
  const { data, loading, error } = useJsonFetch<MemoMissingApi>(
    `/api/deals/${dealId}/credit-memo/canonical/missing`,
  );

  const required = data?.required_keys?.length ?? 0;
  const present = data?.present_keys?.length ?? 0;
  const missing = data?.missing_keys?.length ?? 0;
  const ready = data && missing === 0 && required > 0;
  const partial = data && missing > 0 && present > 0;

  const status = !data
    ? "PENDING"
    : ready
      ? "READY"
      : partial
        ? "PARTIAL"
        : "INCOMPLETE";

  const tone = ready ? "success" : partial ? "warn" : "neutral";

  const summary = loading && !data
    ? "Loading memo state…"
    : ready
      ? "Canonical memo has all required facts. Open the memo to review qualitative sections."
      : partial
        ? `Memo has ${present} of ${required} required facts. Review reconciliation below.`
        : data
          ? "Memo not yet generated."
          : "Status unavailable.";

  return (
    <StatusListPanel
      testId="committee-credit-memo-panel"
      title="Credit Memo"
      icon="description"
      badge={status}
      badgeTone={tone}
      summary={summary}
      loading={loading}
      error={error}
      rows={
        data
          ? [
              {
                id: "facts-coverage",
                label: "Required canonical facts",
                detail: `${present} of ${required} present`,
                tone: ready ? "success" : "warn",
                badge: `${required > 0 ? Math.round((present / required) * 100) : 0}%`,
              },
              {
                id: "missing-facts",
                label: "Missing facts",
                detail:
                  missing === 0
                    ? "None — all required facts present."
                    : "See reconciliation panel below for fix paths.",
                tone: missing === 0 ? "success" : "warn",
                badge: String(missing),
              },
            ]
          : []
      }
      links={[
        { label: "Open Memo", href: `/deals/${dealId}/credit-memo` },
        { label: "Memo Template", href: `/deals/${dealId}/memo-template` },
      ]}
    />
  );
}
