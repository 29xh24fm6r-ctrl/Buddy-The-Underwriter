import { runManualUrlConnector, sourceDomainOf } from "./index";
import type { SourceConnectorKind } from "./types";

/**
 * SPEC-BIE-ACTIVE-SOURCE-COLLECTION-PR-B
 *
 * Shared persist-core for attaching a fetched source to a committee task — the
 * exact flow the manual source-snapshot route has always used, factored out so
 * the deterministic industry-source collector reuses it byte-for-byte instead of
 * duplicating insert logic. Runs the manual URL connector (capped fetch → sha256
 * → snapshot), inserts the snapshot row, advances the task WORKFLOW status
 * pending → collected, and captures the durable loan-file artifact.
 *
 * INVARIANTS (unchanged): NEVER sets committee_grade_accepted, never touches
 * review_status, never auto-clears a committee blocker, never changes the gate.
 */

export type TrustedTask = {
  id: string;
  mission_id: string;
  deal_id: string;
  status: string | null;
};

export type PersistSnapshotArgs = {
  dealId: string;
  task: TrustedTask;
  connectorKind: SourceConnectorKind;
  sourceUrl: string;
  sourceType: string;
  note?: string | null;
  candidateMetadata?: Record<string, unknown>;
  actorId?: string | null;
};

export type PersistSnapshotResult = {
  ok: boolean;
  error?: string;
  status?: number;
  snapshot?: Record<string, unknown>;
  task?: Record<string, unknown>;
  artifact?: { artifact_id: string | null; view_url: string | null };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function persistManualSourceSnapshot(sb: any, args: PersistSnapshotArgs): Promise<PersistSnapshotResult> {
  const { dealId, task, connectorKind, sourceUrl, sourceType, note = null, candidateMetadata = {}, actorId = null } = args;

  const result = await runManualUrlConnector({
    missionId: task.mission_id,
    dealId: task.deal_id,
    taskId: task.id,
    connectorKind,
    sourceUrl,
    sourceType,
    note,
  });

  if (result.error === "invalid_url") {
    return { ok: false, error: "invalid_url", status: 400 };
  }

  const snap = result.snapshots[0];
  const now = new Date().toISOString();
  const { data: inserted, error: insErr } = await sb
    .from("buddy_research_source_snapshots")
    .insert({
      mission_id: snap.mission_id,
      deal_id: snap.deal_id,
      task_id: task.id,
      source_url: snap.source_url,
      source_type: snap.source_type,
      status: snap.status,
      http_status: snap.http_status,
      content_hash: snap.content_hash,
      content_type: snap.content_type,
      title: snap.title,
      source_title: snap.title,
      source_domain: sourceDomainOf(snap.source_url),
      byte_size: snap.byte_size,
      error: snap.error,
      connector_kind: result.connector_kind,
      connector_mode: result.mode,
      limitations: result.limitations,
      candidate_metadata: candidateMetadata,
      fetched_at: now,
    })
    .select(
      "id, task_id, source_url, source_type, status, connector_kind, connector_mode, source_domain, content_hash, limitations, created_at",
    )
    .maybeSingle();

  if (insErr || !inserted) {
    return { ok: false, error: insErr?.message ?? "snapshot_insert_failed", status: 500 };
  }

  // Advance the banker WORKFLOW status pending → collected on success only.
  // NEVER touch review_status / committee_grade_accepted / resolved_status.
  let updatedTask: Record<string, unknown> = task;
  if (snap.status === "collected" && task.status === "pending") {
    const { data: t2 } = await sb
      .from("buddy_research_committee_tasks")
      .update({ status: "collected", source_snapshot_id: inserted.id, updated_at: now })
      .eq("id", task.id)
      .eq("deal_id", dealId)
      .select("id, status, review_status, committee_grade_accepted, resolved_status")
      .maybeSingle();
    if (t2) updatedTask = t2;
  }

  // Durable loan-file artifact (non-fatal; never changes committee scoring/review).
  let artifact: { artifact_id: string | null; view_url: string | null } = { artifact_id: null, view_url: null };
  if (snap.status === "collected") {
    try {
      const { ensureSourceArtifactForSnapshot } = await import("@/lib/research/ensureSourceArtifact");
      const r = await ensureSourceArtifactForSnapshot(sb, inserted.id, {
        createdBy: actorId,
        capture: {
          content: snap.captured_content ?? null,
          encoding: snap.captured_content_encoding ?? null,
          format: snap.captured_format ?? null,
          contentType: snap.content_type ?? null,
          fetchOk: snap.status === "collected",
        },
      });
      if (r.artifact_id) {
        artifact = {
          artifact_id: r.artifact_id,
          view_url: `/api/deals/${dealId}/research/source-artifact?artifact_id=${r.artifact_id}`,
        };
      }
    } catch {
      /* non-fatal: snapshot + task already persisted */
    }
  }

  return { ok: true, snapshot: inserted, task: updatedTask, artifact };
}
