"use client";

import { useStageJsonResource } from "../_shared/useStageJsonResource";
import { StatusListPanel } from "../_shared/StatusListPanel";

type ArtifactsApi = {
  ok?: boolean;
  summary?: {
    total_files?: number;
    queued?: number;
    processing?: number;
    classified?: number;
    matched?: number;
    failed?: number;
    proposed_matches?: number;
    auto_applied_matches?: number;
    confirmed_matches?: number;
  } | null;
};

/**
 * SPEC-06 — stage-owned summary of the intake review pipeline.
 *
 * Pulls /api/deals/[dealId]/artifacts (scope: "documents") and surfaces
 * counts across the AI classification pipeline. The full
 * IntakeReviewTable lives in the Advanced disclosure below.
 */
export function IntakeReviewSurface({ dealId }: { dealId: string }) {
  const { data, loading, error } = useStageJsonResource<ArtifactsApi>(
    `/api/deals/${dealId}/artifacts`,
    { id: "documents:artifacts", scope: "documents" },
  );

  const s = data?.summary ?? null;
  const total = s?.total_files ?? 0;
  const inFlight = (s?.queued ?? 0) + (s?.processing ?? 0);
  const failed = s?.failed ?? 0;
  const proposed = s?.proposed_matches ?? 0;

  const tone =
    failed > 0
      ? "danger"
      : inFlight > 0
        ? "warn"
        : "success";

  const summary = loading && !data
    ? "Loading intake review…"
    : `${total} files · ${inFlight} in flight · ${failed} failed · ${proposed} proposed matches.`;

  return (
    <StatusListPanel
      testId="documents-intake-review-surface"
      title="Intake Review"
      icon="rule_folder"
      badge={
        loading && !data
          ? null
          : failed > 0
            ? `${failed} FAILED`
            : inFlight > 0
              ? `${inFlight} IN FLIGHT`
              : "READY"
      }
      badgeTone={tone}
      summary={summary}
      loading={loading}
      error={error}
      rows={
        s
          ? [
              {
                id: "matched",
                label: "Matched / classified",
                detail: `${s.matched ?? 0} matched · ${s.classified ?? 0} classified`,
                tone: "neutral",
              },
              ...(proposed > 0
                ? [
                    {
                      id: "proposed",
                      label: "Proposed matches awaiting confirmation",
                      detail: `${proposed} proposals`,
                      tone: "warn" as const,
                      badge: String(proposed),
                    },
                  ]
                : []),
            ]
          : []
      }
      links={[
        { label: "Review Intake", href: `/deals/${dealId}/intake/slots` },
      ]}
    />
  );
}
