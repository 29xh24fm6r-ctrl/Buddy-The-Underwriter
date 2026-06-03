/**
 * SPEC-BIE-SOURCE-SNAPSHOT-LEDGER-AND-OFFICIAL-SOURCE-CONNECTORS-1
 *
 * Orchestrates the first evidence-collection layer:
 *   1. derive committee blocker resolutions from the latest gate + evidence
 *   2. generate evidence-collection task specs (one per blocker × task_type)
 *   3. idempotently upsert tasks into buddy_research_committee_tasks
 *   4. auto-collect the borrower official website → buddy_research_source_snapshots,
 *      link it to the borrower-website task and mark it collected
 *
 * Manual tasks stay "pending" — committee readiness is NOT auto-cleared; status
 * only advances to "accepted" via an explicit (future) banker action. Never
 * mutates gate scoring/semantics. Fully non-fatal for the caller (runMission).
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildCommitteeBlockerResolutions } from "./committeeBlockerResolution";
import {
  generateCommitteeEvidenceTaskSpecs,
  type CommitteeEvidenceTask,
} from "./committeeEvidenceTasks";
import { fetchBorrowerWebsiteSnapshot, type BorrowerWebsiteSnapshot } from "./sourceSnapshot";

type SupabaseAdmin = ReturnType<typeof supabaseAdmin>;

export async function ensureCommitteeEvidenceTasks(opts: {
  missionId: string;
  dealId: string;
}): Promise<{ tasks_upserted: number; website_snapshot: BorrowerWebsiteSnapshot | null }> {
  const sb = supabaseAdmin();
  const { missionId, dealId } = opts;

  // 1. Latest gate for this mission + mission subject + evidence rows.
  const { data: gate } = await sb
    .from("buddy_research_quality_gates")
    .select("committee_blockers, evidence_quality, section_source_statuses, contradiction_checklist")
    .eq("mission_id", missionId)
    .order("evaluated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!gate) return { tasks_upserted: 0, website_snapshot: null };

  const { data: mission } = await sb
    .from("buddy_research_missions").select("subject").eq("id", missionId).maybeSingle();
  const subject = ((mission as any)?.subject ?? null) as
    | { company_name?: string | null; website?: string | null; naics_code?: string | null }
    | null;

  const { data: evidenceRows } = await sb
    .from("buddy_research_evidence")
    .select("id, section, thread_origin, evidence_type, claim, confidence, source_uris, source_types")
    .eq("mission_id", missionId);

  // 2. Derive resolutions → 3. task specs.
  const resolutions = buildCommitteeBlockerResolutions({
    committeeBlockers: ((gate as any).committee_blockers as string[]) ?? [],
    evidenceQuality: (gate as any).evidence_quality ?? null,
    sectionSourceStatuses: (gate as any).section_source_statuses ?? [],
    contradictionChecklist: (gate as any).contradiction_checklist ?? [],
    evidenceRows: (evidenceRows as any) ?? [],
    subject: subject ? { company_name: subject.company_name ?? null, website: subject.website ?? null } : null,
  });
  const specs = generateCommitteeEvidenceTaskSpecs(resolutions, subject);
  if (specs.length === 0) return { tasks_upserted: 0, website_snapshot: null };

  // 4. Idempotent upsert — ignoreDuplicates preserves existing task status
  // (never downgrades an accepted/collected task back to pending).
  const rows = specs.map((s) => ({
    mission_id: missionId,
    deal_id: dealId,
    blocker_id: s.blocker_id,
    blocker_type: s.blocker_type,
    task_type: s.task_type,
    title: s.title,
    instructions: s.instructions,
    auto_collectible: s.auto_collectible,
    target_url: s.target_url,
    status: "pending",
  }));
  await sb
    .from("buddy_research_committee_tasks")
    .upsert(rows, { onConflict: "mission_id,blocker_id,task_type", ignoreDuplicates: true });

  // 5. Auto-collect the borrower official website (once).
  const websiteSnapshot = await collectBorrowerWebsite(sb, missionId, dealId, subject?.website ?? null);

  return { tasks_upserted: specs.length, website_snapshot: websiteSnapshot };
}

async function collectBorrowerWebsite(
  sb: SupabaseAdmin,
  missionId: string,
  dealId: string,
  website: string | null,
): Promise<BorrowerWebsiteSnapshot | null> {
  if (!website) return null;

  // Skip if a collected snapshot already exists for this mission.
  const { data: existing } = await sb
    .from("buddy_research_source_snapshots")
    .select("id, status")
    .eq("mission_id", missionId)
    .eq("source_type", "borrower_official_website")
    .eq("status", "collected")
    .limit(1)
    .maybeSingle();
  if (existing) return null;

  const snap = await fetchBorrowerWebsiteSnapshot(website, website);

  const { data: inserted } = await sb
    .from("buddy_research_source_snapshots")
    .insert({
      mission_id: missionId,
      deal_id: dealId,
      source_url: snap.source_url,
      source_type: "borrower_official_website",
      status: snap.status,
      http_status: snap.http_status,
      content_hash: snap.content_hash,
      content_type: snap.content_type,
      title: snap.title,
      byte_size: snap.byte_size,
      error: snap.error,
      fetched_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  // Link the snapshot to the borrower-website task; mark collected only on success.
  if (inserted?.id) {
    const update: Record<string, unknown> = {
      source_snapshot_id: inserted.id,
      updated_at: new Date().toISOString(),
    };
    if (snap.status === "collected") update.status = "collected";
    await sb
      .from("buddy_research_committee_tasks")
      .update(update)
      .eq("mission_id", missionId)
      .eq("task_type", "borrower_website_snapshot")
      .eq("status", "pending");
  }

  return snap;
}

/** Load persisted committee evidence tasks for a mission (for the quality API). */
export async function loadCommitteeTasks(
  sb: SupabaseAdmin,
  missionId: string,
): Promise<CommitteeEvidenceTask[]> {
  const { data } = await sb
    .from("buddy_research_committee_tasks")
    .select("id, blocker_id, blocker_type, task_type, title, instructions, status, auto_collectible, target_url, source_snapshot_id")
    .eq("mission_id", missionId)
    .order("created_at", { ascending: true });
  return (data as CommitteeEvidenceTask[]) ?? [];
}
