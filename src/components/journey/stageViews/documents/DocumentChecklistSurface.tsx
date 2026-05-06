"use client";

import { useStageJsonResource } from "../_shared/useStageJsonResource";
import { StatusListPanel } from "../_shared/StatusListPanel";

type ChecklistApi = {
  ok?: boolean;
  state?: "empty" | "processing" | "ready";
  total?: number;
  received?: number;
  pending?: unknown[];
  optional?: number;
};

/**
 * SPEC-06 — stage-owned summary surface for the document checklist.
 *
 * Renders an inline status panel pulled from /api/deals/[dealId]/checklist
 * via useStageJsonResource (scope: "documents"), so it participates in
 * scoped refresh without requiring a remount. The full per-row checklist
 * still lives in CenterColumn / CanonicalChecklistPanel below — this is a
 * lightweight summary head.
 */
export function DocumentChecklistSurface({ dealId }: { dealId: string }) {
  const { data, loading, error } = useStageJsonResource<ChecklistApi>(
    `/api/deals/${dealId}/checklist`,
    { id: "documents:checklist", scope: "documents" },
  );

  const total = data?.total ?? 0;
  const received = data?.received ?? 0;
  const pending = (data?.pending?.length ?? 0) as number;
  const state = data?.state ?? "empty";
  const tone =
    state === "ready"
      ? "success"
      : state === "processing"
        ? "warn"
        : "neutral";

  const summary = loading && !data
    ? "Loading checklist…"
    : `${received} of ${total} required documents received · ${pending} pending.`;

  return (
    <StatusListPanel
      testId="documents-checklist-surface"
      title="Document Checklist"
      icon="checklist"
      badge={state.toUpperCase()}
      badgeTone={tone}
      summary={summary}
      loading={loading}
      error={error}
      links={[
        { label: "Open Checklist", href: `/deals/${dealId}/cockpit?focus=documents` },
        { label: "Documents", href: `/deals/${dealId}/documents` },
      ]}
    />
  );
}
