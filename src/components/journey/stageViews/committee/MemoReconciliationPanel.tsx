"use client";

import { StatusListPanel, useJsonFetch, type StatusRow } from "../_shared/StatusListPanel";

type MemoMissingApi = {
  ok?: boolean;
  required_keys?: string[];
  present_keys?: string[];
  missing_keys?: string[];
  suggestions?: { key: string; suggestion: string }[];
};

/**
 * Reconciliation between extracted facts, underwriting outputs, and memo
 * fields. Renders missing canonical facts inline with the suggested fix path
 * supplied by the canonical missing endpoint.
 */
export function MemoReconciliationPanel({ dealId }: { dealId: string }) {
  const { data, loading, error } = useJsonFetch<MemoMissingApi>(
    `/api/deals/${dealId}/credit-memo/canonical/missing`,
  );

  const missing = data?.missing_keys ?? [];
  const suggestionsByKey = new Map(
    (data?.suggestions ?? []).map((s) => [s.key, s.suggestion]),
  );

  const rows: StatusRow[] = missing.map((key) => ({
    id: key,
    label: humanizeFactKey(key),
    detail: suggestionsByKey.get(key) ?? "Provide the underlying source and re-run backfill.",
    tone: "warn",
    badge: "GAP",
  }));

  return (
    <StatusListPanel
      testId="committee-memo-reconciliation-panel"
      title="Memo Reconciliation"
      icon="rule"
      badge={
        loading && !data
          ? null
          : missing.length === 0
            ? "ALL ALIGNED"
            : `${missing.length} GAPS`
      }
      badgeTone={missing.length === 0 ? "success" : "warn"}
      summary={
        loading && !data
          ? "Reconciling extracted facts, underwriting outputs, and memo fields…"
          : missing.length === 0
            ? "Memo data is reconciled — no missing canonical facts."
            : "Each gap has a fix path. Resolve them before sending to committee."
      }
      loading={loading}
      error={error}
      rows={rows}
      emptyMessage="No reconciliation gaps."
      links={[
        { label: "Refresh facts", href: `/deals/${dealId}/financials` },
        { label: "Open Spreads", href: `/deals/${dealId}/spreads/standard` },
      ]}
    />
  );
}

function humanizeFactKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
