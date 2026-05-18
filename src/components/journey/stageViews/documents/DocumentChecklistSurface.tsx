"use client";

import { useStageJsonResource } from "../_shared/useStageJsonResource";
import { StatusListPanel } from "../_shared/StatusListPanel";

type ChecklistApi = {
  ok?: boolean;
  state?: "empty" | "processing" | "ready";
  received?: Array<{ checklist_key?: string; label?: string; status?: string }>;
  pending?: Array<{ checklist_key?: string; label?: string; status?: string }>;
  optional?: Array<{ checklist_key?: string; label?: string; status?: string }>;
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

  const receivedCount = data?.received?.length ?? 0;
  const pendingCount = data?.pending?.length ?? 0;
  const optionalCount = data?.optional?.length ?? 0;
  const total = receivedCount + pendingCount;
  const state = data?.state ?? "empty";
  const tone =
    state === "ready"
      ? "success"
      : state === "processing"
        ? "warn"
        : "neutral";

  const summary = loading && !data
    ? "Loading checklist…"
    : `${receivedCount} of ${total} required documents received · ${pendingCount} pending.`;

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
