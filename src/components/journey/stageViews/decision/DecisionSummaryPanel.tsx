"use client";

import { StatusListPanel, useJsonFetch, type StatusRow } from "../_shared/StatusListPanel";

type DecisionApi = {
  ok?: boolean;
  snapshot?: {
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
 * Decision summary — displays current decision (approved / declined /
 * needs-more-info) and confidence pulled from /decision/latest.
 */
export function DecisionSummaryPanel({ dealId }: { dealId: string }) {
  const { data, loading, error } = useJsonFetch<DecisionApi>(
    `/api/deals/${dealId}/decision/latest`,
  );

  const snapshot = data?.snapshot ?? null;
  const decisionRaw = snapshot?.decision ?? snapshot?.status ?? null;
  const decision = decisionRaw ? String(decisionRaw).toLowerCase() : null;
  const tone = decision ? TONE_FOR_DECISION[decision] ?? "neutral" : "neutral";
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
        loading && !data
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
