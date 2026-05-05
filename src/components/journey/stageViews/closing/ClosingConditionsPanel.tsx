"use client";

import { StatusListPanel, useJsonFetch, type StatusRow } from "../_shared/StatusListPanel";

type ConditionsApi = {
  ok?: boolean;
  conditions?: Array<{
    id?: string;
    title?: string;
    description?: string | null;
    severity?: string | null;
    status?: string | null;
    pre_close?: boolean | null;
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
 * Pre-close conditions tracker. Reuses the shared `/conditions` API and
 * filters down to required/open conditions for the closing surface.
 */
export function ClosingConditionsPanel({ dealId }: { dealId: string }) {
  const { data, loading, error } = useJsonFetch<ConditionsApi>(
    `/api/deals/${dealId}/conditions`,
  );

  const all = data?.conditions ?? [];
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
        loading && !data
          ? null
          : all.length === 0
            ? "NONE"
            : `${requiredOpen.length}/${required.length} REQ OPEN`
      }
      badgeTone={requiredOpen.length === 0 ? "success" : "warn"}
      summary={
        loading && !data
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
