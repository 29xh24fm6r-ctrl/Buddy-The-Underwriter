"use client";

import { StatusListPanel, useJsonFetch, type StatusRow } from "../_shared/StatusListPanel";

type OverridesApi = {
  ok?: boolean;
  overrides?: Array<{
    id?: string;
    field_path?: string;
    old_value?: unknown;
    new_value?: unknown;
    reason?: string | null;
    severity?: string | null;
    requires_review?: boolean;
    created_at?: string | null;
  }>;
};

const SEVERITY_TONE: Record<string, "danger" | "warn" | "info" | "neutral"> = {
  HIGH: "danger",
  MEDIUM: "warn",
  LOW: "info",
};

/**
 * Override audit trail — pulls from /api/deals/[dealId]/overrides and lists
 * recent decision overrides with rationale.
 */
export function OverrideAuditPanel({ dealId }: { dealId: string }) {
  const { data, loading, error } = useJsonFetch<OverridesApi>(
    `/api/deals/${dealId}/overrides`,
  );

  const overrides = (data?.overrides ?? []).slice(0, 10);

  const rows: StatusRow[] = overrides.map((o, i) => {
    const severity = (o.severity ?? "").toUpperCase();
    const tone = SEVERITY_TONE[severity] ?? "neutral";
    const oldVal = formatValue(o.old_value);
    const newVal = formatValue(o.new_value);
    const detail = o.reason
      ? `${o.reason}${oldVal !== "—" || newVal !== "—" ? ` · ${oldVal} → ${newVal}` : ""}`
      : `${oldVal} → ${newVal}`;
    return {
      id: o.id ?? `${o.field_path}-${i}`,
      label: o.field_path ?? "(field unknown)",
      detail,
      tone,
      badge: severity || (o.requires_review ? "REVIEW" : "AUDIT"),
    };
  });

  return (
    <StatusListPanel
      testId="decision-override-audit-panel"
      title="Override Audit"
      icon="history_edu"
      badge={loading && !data ? null : `${overrides.length}`}
      badgeTone={overrides.length === 0 ? "success" : "info"}
      summary={
        loading && !data
          ? "Loading override history…"
          : overrides.length === 0
            ? "No decision overrides have been recorded."
            : "Most recent overrides — full audit trail in the decision overrides surface."
      }
      loading={loading}
      error={error}
      rows={rows}
      emptyMessage="No overrides on file."
      links={[
        { label: "Decision Overrides", href: `/deals/${dealId}/decision/overrides` },
        { label: "Audit Replay", href: `/deals/${dealId}/decision/replay` },
      ]}
    />
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const json = JSON.stringify(v);
    return json.length > 40 ? `${json.slice(0, 40)}…` : json;
  } catch {
    return "[object]";
  }
}
