"use client";

import { StatusListPanel, type StatusRow } from "../_shared/StatusListPanel";
import type { MemoSummary } from "./CreditMemoPanel";

/**
 * Reconciliation between extracted facts, underwriting outputs, and memo
 * fields.
 *
 * SPEC-04: data flows from `CommitteeStageView` (single fetch). This panel
 * renders only.
 */
export function MemoReconciliationPanel({
  dealId,
  memoSummary,
  loading = false,
  error = null,
}: {
  dealId: string;
  memoSummary: MemoSummary | null;
  loading?: boolean;
  error?: string | null;
}) {
  const missing = memoSummary?.missing_keys ?? [];
  const suggestionsByKey = new Map(
    (memoSummary?.suggestions ?? []).map((s) => [s.key, s.suggestion]),
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
        loading && !memoSummary
          ? null
          : missing.length === 0
            ? "ALL ALIGNED"
            : `${missing.length} GAPS`
      }
      badgeTone={missing.length === 0 ? "success" : "warn"}
      summary={
        loading && !memoSummary
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
