"use client";

import { StatusListPanel, type StatusRow } from "../_shared/StatusListPanel";

export type OverridesList = {
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
 * Override audit trail — pure presentation. Data lifted to stage in SPEC-05.
 */
export function OverrideAuditPanel({
  dealId,
  overrides,
  loading = false,
  error = null,
}: {
  dealId: string;
  overrides: OverridesList | null;
  loading?: boolean;
  error?: string | null;
}) {
  const rows: StatusRow[] = (overrides?.overrides ?? []).slice(0, 10).map((o, i) => {
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

  const total = rows.length;

  return (
    <StatusListPanel
      testId="decision-override-audit-panel"
      title="Override Audit"
      icon="history_edu"
      badge={loading && !overrides ? null : `${total}`}
      badgeTone={total === 0 ? "success" : "info"}
      summary={
        loading && !overrides
          ? "Loading override history…"
          : total === 0
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
