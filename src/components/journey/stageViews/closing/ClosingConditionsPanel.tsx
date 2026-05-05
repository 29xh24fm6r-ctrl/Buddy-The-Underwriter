"use client";

import { StatusListPanel, type StatusRow } from "../_shared/StatusListPanel";
import type { ConditionsList } from "../decision/ApprovalConditionsPanel";

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
 * Pre-close conditions tracker — pure presentation. Data lifted to stage.
 */
export function ClosingConditionsPanel({
  dealId,
  conditions,
  loading = false,
  error = null,
}: {
  dealId: string;
  conditions: ConditionsList | null;
  loading?: boolean;
  error?: string | null;
}) {
  const all = conditions?.conditions ?? [];
  const required = all.filter((c) => (c.severity ?? "").toUpperCase() === "REQUIRED");
  const open = all.filter(
    (c) => !["COMPLETE", "CLEARED"].includes((c.status ?? "OPEN").toUpperCase()),
  );
  const requiredOpen = required.filter(
    (c) => !["COMPLETE", "CLEARED"].includes((c.status ?? "OPEN").toUpperCase()),
  );

  const rows: StatusRow[] = all.slice(0, 10).map((c, i) => {
    const severity = (c.severity ?? "").toUpperCase();
    const status = (c.status ?? "OPEN").toUpperCase();
    const tone = STATUS_TONE[status] ?? SEVERITY_TONE[severity] ?? "neutral";
    return {
      id: c.id ?? `${c.title ?? "condition"}-${i}`,
      label: c.title ?? "(unnamed condition)",
      detail: c.description ?? null,
      tone,
      badge: status,
    };
  });

  return (
    <StatusListPanel
      testId="closing-conditions-panel"
      title="Closing Conditions"
      icon="checklist_rtl"
      badge={
        loading && !conditions
          ? null
          : all.length === 0
            ? "NONE"
            : `${requiredOpen.length}/${required.length} REQ OPEN`
      }
      badgeTone={requiredOpen.length === 0 ? "success" : "warn"}
      summary={
        loading && !conditions
          ? "Loading closing conditions…"
          : all.length === 0
            ? "No closing conditions on file."
            : `${all.length} total · ${open.length} open · ${requiredOpen.length} required still open.`
      }
      loading={loading}
      error={error}
      rows={rows}
      emptyMessage="No conditions defined."
      links={[
        { label: "Open Conditions", href: `/deals/${dealId}/conditions` },
        { label: "Conditions PDF", href: `/api/deals/${dealId}/conditions/pdf` },
      ]}
    />
  );
}
