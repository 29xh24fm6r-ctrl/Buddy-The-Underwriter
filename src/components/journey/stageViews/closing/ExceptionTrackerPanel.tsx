"use client";

import { StatusListPanel, type StatusRow } from "../_shared/StatusListPanel";
import type { PostCloseData } from "./PostCloseChecklistPanel";

export type FinancialExceptions = {
  ok?: boolean;
  exceptions?: Array<{
    id?: string;
    fact_key?: string;
    severity?: string;
    narrative?: string | null;
    status?: string | null;
    requires_committee_disclosure?: boolean;
  }>;
};

const SEVERITY_TONE: Record<string, "danger" | "warn" | "info" | "neutral"> = {
  HIGH: "danger",
  CRITICAL: "danger",
  MEDIUM: "warn",
  LOW: "info",
};

/**
 * Exception tracker — pure presentation. Combines stage-owned financial
 * exceptions and post-close exception data.
 */
export function ExceptionTrackerPanel({
  dealId,
  financialExceptions,
  postClose,
  loading = false,
  error = null,
}: {
  dealId: string;
  financialExceptions: FinancialExceptions | null;
  postClose: PostCloseData | null;
  loading?: boolean;
  error?: string | null;
}) {
  const finRows: StatusRow[] = (financialExceptions?.exceptions ?? [])
    .slice(0, 5)
    .map((e, i) => {
      const severity = (e.severity ?? "").toUpperCase();
      return {
        id: `fin-${e.id ?? `${e.fact_key}-${i}`}`,
        label: e.fact_key ?? "(financial exception)",
        detail: e.narrative ?? null,
        tone: SEVERITY_TONE[severity] ?? "neutral",
        badge: severity || "FIN",
      };
    });

  const pcRows: StatusRow[] = (postClose?.exceptions ?? [])
    .slice(0, 5)
    .map((e) => {
      const severity = (e.severity ?? "").toUpperCase();
      return {
        id: `pc-${e.id}`,
        label: e.exceptionCode ?? "(post-close exception)",
        detail: e.openedAt ? `Opened ${new Date(e.openedAt).toLocaleDateString()}` : null,
        tone: SEVERITY_TONE[severity] ?? "neutral",
        badge: severity || "PC",
      };
    });

  const rows = [...finRows, ...pcRows];
  const total = rows.length;

  return (
    <StatusListPanel
      testId="closing-exception-tracker-panel"
      title="Exceptions"
      icon="warning"
      badge={loading && total === 0 ? null : total === 0 ? "CLEAR" : `${total}`}
      badgeTone={total === 0 ? "success" : "warn"}
      summary={
        loading && total === 0
          ? "Loading exceptions…"
          : total === 0
            ? "No financial or post-close exceptions are open."
            : `${finRows.length} financial · ${pcRows.length} post-close.`
      }
      loading={loading}
      error={error}
      rows={rows}
      emptyMessage="No open exceptions."
      links={[
        { label: "Financial Validation", href: `/deals/${dealId}/financial-validation` },
        { label: "Post-Close", href: `/deals/${dealId}/post-close` },
      ]}
    />
  );
}
