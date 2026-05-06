"use client";

import { useStageJsonResource } from "../_shared/useStageJsonResource";
import { StatusListPanel } from "../_shared/StatusListPanel";

type UploadStatusApi = {
  ok?: boolean;
  processing?: number;
  queued?: number;
  failed?: number;
  recent?: Array<{ id?: string; filename?: string; status?: string }>;
};

/**
 * SPEC-06 — stage-owned summary of borrower upload activity.
 *
 * Reads /api/deals/[dealId]/uploads/status (scope: "documents"). The full
 * upload-request composer / link manager remains in BorrowerRequestComposerCard
 * + BorrowerUploadLinksCard inside the Intake stage; this surface is a
 * lightweight progress chip for the Documents stage view.
 */
export function UploadRequestSurface({ dealId }: { dealId: string }) {
  const { data, loading, error } = useStageJsonResource<UploadStatusApi>(
    `/api/deals/${dealId}/uploads/status`,
    { id: "documents:uploads", scope: "documents" },
  );

  const processing = data?.processing ?? 0;
  const queued = data?.queued ?? 0;
  const failed = data?.failed ?? 0;
  const inFlight = processing + queued;

  const tone =
    failed > 0 ? "danger" : inFlight > 0 ? "warn" : "success";

  const summary = loading && !data
    ? "Loading upload status…"
    : inFlight === 0 && failed === 0
      ? "No pending uploads."
      : `${inFlight} in flight · ${failed} failed.`;

  return (
    <StatusListPanel
      testId="documents-upload-request-surface"
      title="Upload Activity"
      icon="cloud_upload"
      badge={
        loading && !data
          ? null
          : failed > 0
            ? `${failed} FAILED`
            : inFlight > 0
              ? `${inFlight} IN FLIGHT`
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
