/**
 * SPEC-BIE-SOURCE-SNAPSHOT-TO-LOAN-FILE-ARTIFACT-1
 *
 * Server-side capture of a collected source snapshot into a durable loan-file
 * artifact (buddy_research_source_artifacts) with two-way linkage. Idempotent
 * (one artifact per source_snapshot_id, enforced by a UNIQUE constraint) and
 * non-fatal for the snapshot path. NEVER changes committee scoring, never marks
 * committee-grade, never clears a blocker.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildSourceArtifactRow, sourceArtifactTitle } from "./sourceArtifact";
import { normalizeDomain } from "./sourcePolicy";

type SupabaseAdmin = ReturnType<typeof supabaseAdmin>;

export type EnsureArtifactResult = {
  artifact_id: string | null;
  created: boolean;
  error?: string;
};

/**
 * Capture one collected source snapshot into a durable loan-file artifact.
 * Idempotent: returns the existing artifact if one already exists for the
 * snapshot. Only collected snapshots are captured.
 */
export async function ensureSourceArtifactForSnapshot(
  sb: SupabaseAdmin,
  snapshotId: string,
  opts?: { createdBy?: string | null },
): Promise<EnsureArtifactResult> {
  const { data: snap } = await sb
    .from("buddy_research_source_snapshots")
    .select(
      "id, mission_id, deal_id, source_url, source_type, status, http_status, content_hash, title, artifact_id, task_id, connector_kind, connector_mode, limitations, candidate_metadata",
    )
    .eq("id", snapshotId)
    .maybeSingle();

  if (!snap) return { artifact_id: null, created: false, error: "snapshot_not_found" };
  const s = snap as any;
  if (s.status !== "collected") {
    return { artifact_id: s.artifact_id ?? null, created: false, error: "snapshot_not_collected" };
  }
  if (s.artifact_id) return { artifact_id: s.artifact_id, created: false };

  // Idempotency check (also covers the race where the FK back-link wasn't set).
  const { data: existing } = await sb
    .from("buddy_research_source_artifacts")
    .select("id")
    .eq("source_snapshot_id", snapshotId)
    .maybeSingle();
  if (existing) {
    await sb.from("buddy_research_source_snapshots").update({ artifact_id: (existing as any).id }).eq("id", snapshotId);
    return { artifact_id: (existing as any).id, created: false };
  }

  // Best-effort committee-task context for the receipt. Prefer the snapshot's
  // own task_id (set by the manual-URL connector); else find a task linked via
  // source_snapshot_id (the auto-collect path).
  let taskQuery = sb.from("buddy_research_committee_tasks").select("id, title, blocker_type, review_status");
  taskQuery = s.task_id ? taskQuery.eq("id", s.task_id) : taskQuery.eq("source_snapshot_id", snapshotId);
  const { data: task } = await taskQuery.limit(1).maybeSingle();

  const row = buildSourceArtifactRow({
    dealId: s.deal_id,
    missionId: s.mission_id ?? null,
    sourceSnapshotId: snapshotId,
    taskId: (task as any)?.id ?? null,
    title: sourceArtifactTitle(s.source_type, s.title),
    sourceUrl: s.source_url ?? null,
    sourceType: s.source_type ?? null,
    sourceDomain: normalizeDomain(s.source_url),
    connectorKind: s.connector_kind ?? null,
    connectorMode: s.connector_mode ?? null,
    httpStatus: s.http_status ?? null,
    contentHash: s.content_hash ?? null,
    capturedAt: new Date().toISOString(),
    taskTitle: (task as any)?.title ?? null,
    blockerLabel: (task as any)?.blocker_type ?? null,
    reviewStatus: (task as any)?.review_status ?? null,
    limitations: Array.isArray(s.limitations) ? s.limitations : [],
    candidateMetadata: (s.candidate_metadata as Record<string, unknown>) ?? {},
    excerpt: s.title ?? null,
    createdBy: opts?.createdBy ?? "buddy_system",
  });

  const { data: inserted, error } = await sb
    .from("buddy_research_source_artifacts")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error || !inserted) {
    // Unique-violation race: another path created it — return that.
    const { data: again } = await sb
      .from("buddy_research_source_artifacts")
      .select("id")
      .eq("source_snapshot_id", snapshotId)
      .maybeSingle();
    if (again) {
      await sb.from("buddy_research_source_snapshots").update({ artifact_id: (again as any).id }).eq("id", snapshotId);
      return { artifact_id: (again as any).id, created: false };
    }
    return { artifact_id: null, created: false, error: error?.message ?? "artifact_insert_failed" };
  }

  const artifactId = (inserted as any).id as string;
  await sb.from("buddy_research_source_snapshots").update({ artifact_id: artifactId }).eq("id", snapshotId);
  if ((task as any)?.id) {
    await sb.from("buddy_research_committee_tasks").update({ source_artifact_id: artifactId }).eq("id", (task as any).id);
  }
  return { artifact_id: artifactId, created: true };
}

export type BackfillResult = {
  dry_run: boolean;
  candidates: number;
  created: number;
  results: Array<{ snapshot_id: string; source_type?: string | null; artifact_id?: string | null; created?: boolean; would_create?: boolean; error?: string }>;
};

/**
 * Guarded backfill: capture artifacts for collected snapshots that lack one.
 * DRY-RUN by default — pass apply:true to mutate. Scope to a deal/mission.
 */
export async function backfillSourceSnapshotArtifacts(
  sb: SupabaseAdmin,
  opts: { dealId?: string; missionId?: string; apply?: boolean },
): Promise<BackfillResult> {
  const apply = opts.apply === true;
  let q = sb
    .from("buddy_research_source_snapshots")
    .select("id, deal_id, mission_id, source_type, status, artifact_id")
    .eq("status", "collected");
  if (opts.missionId) q = q.eq("mission_id", opts.missionId);
  if (opts.dealId) q = q.eq("deal_id", opts.dealId);
  const { data: snaps } = await q;
  const pending = ((snaps as any[]) ?? []).filter((s) => !s.artifact_id);

  if (!apply) {
    return {
      dry_run: true,
      candidates: pending.length,
      created: 0,
      results: pending.map((s) => ({ snapshot_id: s.id, source_type: s.source_type, would_create: true })),
    };
  }

  const results: BackfillResult["results"] = [];
  for (const s of pending) {
    const r = await ensureSourceArtifactForSnapshot(sb, s.id);
    results.push({ snapshot_id: s.id, source_type: s.source_type, artifact_id: r.artifact_id, created: r.created, error: r.error });
  }
  return { dry_run: false, candidates: pending.length, created: results.filter((r) => r.created).length, results };
}
