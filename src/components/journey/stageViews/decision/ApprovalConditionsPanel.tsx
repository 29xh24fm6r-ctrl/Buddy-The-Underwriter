"use client";

import { StatusListPanel, type StatusRow } from "../_shared/StatusListPanel";
import type { DealConditionsApi } from "@/lib/journey/contracts/conditions";

/**
 * SPEC-09 — fallback (read-only) consumes the canonical DealConditionsApi
 * shape directly. All fields the panel reads (title, severity, status,
 * description, category) are part of the contract.
 */
export type ConditionsList = DealConditionsApi;

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
 * Approval conditions — pure presentation. Data lifted to stage in SPEC-05.
 */
export function ApprovalConditionsPanel({
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
  const openRequired = required.filter(
    (c) => !["COMPLETE", "CLEARED"].includes((c.status ?? "").toUpperCase()),
  );

  const rows: StatusRow[] = all.slice(0, 8).map((c, i) => {
    const severity = (c.severity ?? "").toUpperCase();
    const status = (c.status ?? "OPEN").toUpperCase();
    const tone = STATUS_TONE[status] ?? SEVERITY_TONE[severity] ?? "neutral";
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
        loading && !conditions
          ? null
          : all.length === 0
            ? "NONE"
            : `${openRequired.length} OPEN`
      }
      badgeTone={openRequired.length === 0 ? "success" : "warn"}
      summary={
        loading && !conditions
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
