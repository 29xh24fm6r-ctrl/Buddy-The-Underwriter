"use client";

import { useStageJsonResource } from "../_shared/useStageJsonResource";
import { StatusListPanel } from "../_shared/StatusListPanel";

type UploadStatusApi = {
  ok?: boolean;
  expected?: number;
  persisted?: number;
  remaining?: number;
  ready?: boolean;
};

/**
 * SPEC-06 — stage-owned summary of borrower upload activity.
 *
 * Reads /api/deals/[dealId]/uploads/readiness (scope: "documents"). The full
 * upload-request composer / link manager remains in BorrowerRequestComposerCard
 * + BorrowerUploadLinksCard inside the Intake stage; this surface is a
 * lightweight progress chip for the Documents stage view.
 */
export function UploadRequestSurface({ dealId }: { dealId: string }) {
  const { data, loading, error } = useStageJsonResource<UploadStatusApi>(
    `/api/deals/${dealId}/uploads/readiness`,
    { id: "documents:uploads", scope: "documents" },
  );

  const expected = data?.expected ?? 0;
  const persisted = data?.persisted ?? 0;
  const remaining = data?.remaining ?? 0;
  const ready = data?.ready ?? false;

  const tone = ready ? "success" : remaining > 0 ? "warn" : "neutral";

  const summary = loading && !data
    ? "Loading upload status…"
    : ready
      ? `All ${persisted} documents received.`
      : expected > 0
        ? `${persisted} of ${expected} received · ${remaining} remaining.`
        : "No pending uploads.";

  return (
    <StatusListPanel
      testId="documents-upload-request-surface"
      title="Upload Activity"
      icon="cloud_upload"
      badge={
        loading && !data
          ? null
          : ready
            ? "READY"
            : remaining > 0
              ? `${remaining} REMAINING`
              : "QUIET"
      }
      badgeTone={tone}
      summary={summary}
      loading={loading}
      error={error}
      links={[
        { label: "Documents", href: `/deals/${dealId}/documents` },
      ]}
    />
  );
}
