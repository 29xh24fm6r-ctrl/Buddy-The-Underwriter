"use client";

import { StatusListPanel, useJsonFetch, type StatusRow } from "../_shared/StatusListPanel";

type FinExceptionsApi = {
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

type PostCloseExceptionsApi = {
  ok?: boolean;
  exceptions?: Array<{
    id: string;
    exceptionCode?: string;
    severity?: string;
    status?: string;
    openedAt?: string | null;
  }>;
};

const SEVERITY_TONE: Record<string, "danger" | "warn" | "info" | "neutral"> = {
  HIGH: "danger",
  CRITICAL: "danger",
  MEDIUM: "warn",
  LOW: "info",
};

/**
 * Exception tracker — combines financial validation exceptions and open
 * post-close monitoring exceptions into one inline list.
 */
export function ExceptionTrackerPanel({ dealId }: { dealId: string }) {
  const fin = useJsonFetch<FinExceptionsApi>(
    `/api/deals/${dealId}/financial-exceptions`,
  );
  const pc = useJsonFetch<PostCloseExceptionsApi>(
    `/api/deals/${dealId}/post-close`,
  );

  const finRows: StatusRow[] = (fin.data?.exceptions ?? [])
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

  const pcRows: StatusRow[] = (pc.data?.exceptions ?? [])
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
  const loading = fin.loading || pc.loading;
  const error = fin.error ?? pc.error ?? null;

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
