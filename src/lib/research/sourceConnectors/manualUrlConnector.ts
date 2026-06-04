/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1 — Phase 3
 *
 * Manual URL source-snapshot connector. The universal MVP path for attaching a
 * banker-supplied source URL (SOS/registry, adverse, industry, market,
 * competitor) to a committee task: normalize → capped fetch → hash → snapshot
 * row linked to the task. NEVER marks the task committee-grade and NEVER sets
 * committee_grade_accepted; review stays unreviewed. Fetch failure is non-fatal
 * (status "failed" + a limitation). No domain guard (the URL is an explicit
 * human-attached source, not autonomous crawling).
 *
 * No server-only — the fetch uses global fetch (mockable in tests). DB
 * persistence is done by the API route, not here.
 */

import { fetchUrlSnapshot, toHttpsUrl } from "../sourceSnapshot";
import { normalizeDomain } from "../sourcePolicy";
import type { SourceConnectorKind, SourceConnectorResult, SourceSnapshotInput } from "./types";

export type ManualUrlConnectorInput = {
  missionId: string;
  dealId: string;
  taskId: string;
  connectorKind: SourceConnectorKind;
  sourceUrl: string;
  sourceType: string;
  note?: string | null;
};

export async function runManualUrlConnector(
  input: ManualUrlConnectorInput,
): Promise<SourceConnectorResult> {
  const limitations: string[] = [
    "Manually attached source — requires analyst review; never auto-accepted for committee.",
  ];
  if (input.note?.trim()) limitations.push(`Note: ${input.note.trim().slice(0, 240)}`);

  const url = toHttpsUrl(input.sourceUrl);
  if (!url) {
    return {
      ok: false,
      connector_kind: input.connectorKind,
      mode: "manual_url",
      task_id: input.taskId,
      snapshots: [],
      candidates: [],
      limitations: [...limitations, "No usable source URL provided."],
      error: "invalid_url",
      requires_review: true,
    };
  }

  const snap = await fetchUrlSnapshot(url);
  if (snap.status !== "collected") {
    limitations.push(`Fetch did not succeed (${snap.error ?? "unknown"}); snapshot recorded as failed.`);
  }

  const snapshot: SourceSnapshotInput = {
    mission_id: input.missionId,
    deal_id: input.dealId,
    source_url: snap.source_url,
    source_type: input.sourceType,
    status: snap.status, // "collected" | "failed"
    http_status: snap.http_status,
    content_hash: snap.content_hash,
    content_type: snap.content_type,
    title: snap.title,
    byte_size: snap.byte_size,
    error: snap.error,
  };

  return {
    ok: snap.status === "collected",
    connector_kind: input.connectorKind,
    mode: "manual_url",
    task_id: input.taskId,
    snapshots: [snapshot],
    candidates: [],
    limitations,
    error: snap.status === "collected" ? null : (snap.error ?? "fetch_failed"),
    requires_review: true,
  };
}

/** Derive a normalized source domain for storage/display. */
export function sourceDomainOf(url: string | null | undefined): string | null {
  return normalizeDomain(url);
}
