"use client";

import { StatusListPanel, type StatusRow } from "../_shared/StatusListPanel";

export type DecisionLatest = {
  ok?: boolean;
  snapshot?: {
    id?: string;
    decision?: string | null;
    decision_summary?: string | null;
    confidence?: number | string | null;
    created_at?: string | null;
    status?: string | null;
  } | null;
  error?: { code: string; message: string };
};

const TONE_FOR_DECISION: Record<string, "success" | "warn" | "danger" | "info" | "neutral"> = {
  approved: "success",
  approve: "success",
  approve_with_conditions: "warn",
  conditional: "warn",
  needs_more_info: "info",
  declined: "danger",
  decline: "danger",
};

/**
 * Decision summary — pure presentation. Data flows from DecisionStageView
 * via the SPEC-05 stage-owned data pattern.
 */
export function DecisionSummaryPanel({
  dealId,
  decision,
  loading = false,
  error = null,
}: {
  dealId: string;
  decision: DecisionLatest | null;
  loading?: boolean;
  error?: string | null;
}) {
  const snapshot = decision?.snapshot ?? null;
  const decisionRaw = snapshot?.decision ?? snapshot?.status ?? null;
  const decisionLower = decisionRaw ? String(decisionRaw).toLowerCase() : null;
  const tone = decisionLower ? TONE_FOR_DECISION[decisionLower] ?? "neutral" : "neutral";
  const confidence = snapshot?.confidence ?? null;
  const createdAt = snapshot?.created_at ?? null;

  const rows: StatusRow[] = snapshot
    ? [
        {
          id: "decision",
          label: "Decision",
          detail: snapshot.decision_summary ?? "(no summary)",
          tone,
          badge: decisionRaw ? String(decisionRaw).toUpperCase() : "PENDING",
        },
        ...(confidence !== null
          ? [
              {
                id: "confidence",
                label: "Confidence",
                detail: typeof confidence === "number" ? confidence.toFixed(2) : String(confidence),
                tone: "neutral" as const,
              },
            ]
          : []),
        ...(createdAt
          ? [
              {
                id: "created-at",
                label: "Recorded",
                detail: new Date(createdAt).toLocaleString(),
                tone: "neutral" as const,
              },
            ]
          : []),
      ]
    : [];

  return (
    <StatusListPanel
      testId="decision-summary-panel"
      title="Decision Summary"
      icon="how_to_vote"
      badge={decisionRaw ? String(decisionRaw).toUpperCase() : "NO DECISION"}
      badgeTone={tone}
      summary={
        loading && !decision
          ? "Loading latest decision…"
          : snapshot
            ? "Latest committee decision recorded for this deal."
            : "No decision has been recorded yet."
      }
      loading={loading}
      error={error}
      rows={rows}
      emptyMessage="No decision recorded."
      links={[
        { label: "Open Decision", href: `/deals/${dealId}/decision` },
        { label: "Audit Replay", href: `/deals/${dealId}/decision/replay` },
      ]}
    />
  );
}
