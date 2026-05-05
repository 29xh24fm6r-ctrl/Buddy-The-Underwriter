"use client";

import { StatusListPanel, useJsonFetch, type StatusRow } from "../_shared/StatusListPanel";

type ConditionsApi = {
  ok?: boolean;
  conditions?: Array<{
    id?: string;
    title?: string;
    description?: string;
    severity?: string;
    status?: string;
    category?: string | null;
  }>;
};

const SEVERITY_TONE: Record<string, "danger" | "warn" | "info" | "neutral"> = {
  REQUIRED: "danger",
  IMPORTANT: "warn",
  FYI: "info",
};

const STATUS_TONE: Record<string, "success" | "warn" | "info" | "neutral"> = {
  COMPLETE: "success",
  CLEARED: "success",
  OPEN: "warn",
  PENDING: "info",
};

/**
 * Approval conditions — inline list pulled from /api/deals/[dealId]/conditions.
 * Surfaces the count of open required conditions and lets the banker open
 * the full conditions surface for editing.
 */
export function ApprovalConditionsPanel({ dealId }: { dealId: string }) {
  const { data, loading, error } = useJsonFetch<ConditionsApi>(
    `/api/deals/${dealId}/conditions`,
  );

  const all = data?.conditions ?? [];
  const required = all.filter((c) => (c.severity ?? "").toUpperCase() === "REQUIRED");
  const openRequired = required.filter(
    (c) => !["COMPLETE", "CLEARED"].includes((c.status ?? "").toUpperCase()),
  );

  const rows: StatusRow[] = all.slice(0, 8).map((c, i) => {
    const severity = (c.severity ?? "").toUpperCase();
    const status = (c.status ?? "OPEN").toUpperCase();
    const tone =
      STATUS_TONE[status] ?? SEVERITY_TONE[severity] ?? "neutral";
    return {
      id: c.id ?? `${c.title ?? "condition"}-${i}`,
      label: c.title ?? "(unnamed condition)",
      detail: c.description ?? c.category ?? null,
      tone,
      badge: status,
    };
  });

  return (
    <StatusListPanel
      testId="decision-approval-conditions-panel"
      title="Approval Conditions"
      icon="task_alt"
      badge={
        loading && !data
          ? null
          : all.length === 0
            ? "NONE"
            : `${openRequired.length} OPEN`
      }
      badgeTone={openRequired.length === 0 ? "success" : "warn"}
      summary={
        loading && !data
          ? "Loading conditions…"
          : all.length === 0
            ? "No conditions defined for this deal."
            : `${all.length} conditions total · ${required.length} required · ${openRequired.length} still open.`
      }
      loading={loading}
      error={error}
      rows={rows}
      emptyMessage="No conditions defined."
      links={[
        { label: "Open Conditions", href: `/deals/${dealId}/conditions` },
      ]}
    />
  );
}
