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
  type CoverageChecklistItem,
  type EvidenceTaskFileStatus,
  type EvidenceTaskResolvedStatus,
  type TaskEvidenceLink,
} from "./committeeEvidenceTasks";
import {
  buildCommitteeTaskPersistRow,
  enrichCommitteeTasks,
} from "./committeeEvidenceLinkage";
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

  // 6. SPEC-BIE-PERSIST-COMMITTEE-EVIDENCE-TASK-STATUS-1: re-link every task to
  // the loan file and persist the derived enrichment so Supabase agrees with the
  // UI. Idempotent + non-fatal — never blocks mission completion, never touches
  // the banker workflow `status`.
  try {
    await enrichAndPersistCommitteeTasks(sb, missionId, dealId);
  } catch (err: any) {
    console.warn("[committeeEvidence] enrich/persist failed (non-fatal):", err?.message);
  }

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

/**
 * Load persisted committee evidence tasks for a mission (for the quality API).
 * SPEC-BIE-PERSIST-COMMITTEE-EVIDENCE-TASK-STATUS-1: also reads the persisted
 * enrichment columns and maps them onto the task's enriched fields, so the UI
 * sees durable statuses even when the read-path re-link is skipped. The columns
 * are nullable/defaulted (rows predating the migration → undefined enrichment).
 */
export async function loadCommitteeTasks(
  sb: SupabaseAdmin,
  missionId: string,
): Promise<CommitteeEvidenceTask[]> {
  const { data } = await sb
    .from("buddy_research_committee_tasks")
    .select(
      "id, blocker_id, blocker_type, task_type, title, instructions, status, auto_collectible, target_url, source_snapshot_id, " +
        "resolved_status, file_status, linked_evidence, coverage_checklist, collected_items, missing_items, needs_review_items, auto_clear_forbidden, last_linked_at, " +
        "review_status, reviewed_by, reviewed_at, review_note, review_reason, committee_grade_accepted",
    )
    .eq("mission_id", missionId)
    .order("created_at", { ascending: true });

  return ((data as any[]) ?? []).map((row) => {
    const task: CommitteeEvidenceTask = {
      id: row.id,
      blocker_id: row.blocker_id,
      blocker_type: row.blocker_type,
      task_type: row.task_type,
      title: row.title,
      instructions: row.instructions,
      status: row.status,
      auto_collectible: row.auto_collectible,
      target_url: row.target_url,
      source_snapshot_id: row.source_snapshot_id,
    };
    // Surface persisted enrichment (read persisted when present; the read-path
    // re-link in enrichCommitteeTasks overrides these with fresh derivations).
    if (row.resolved_status) task.resolved_status = row.resolved_status as EvidenceTaskResolvedStatus;
    if (row.file_status) task.evidence_status = row.file_status as EvidenceTaskFileStatus;
    if (Array.isArray(row.linked_evidence) && row.linked_evidence.length > 0)
      task.linked_evidence = row.linked_evidence as TaskEvidenceLink[];
    if (Array.isArray(row.coverage_checklist) && row.coverage_checklist.length > 0)
      task.checklist = row.coverage_checklist as CoverageChecklistItem[];
    if (Array.isArray(row.collected_items)) task.collected_items = row.collected_items as string[];
    if (Array.isArray(row.missing_items)) task.missing_items = row.missing_items as string[];
    if (Array.isArray(row.needs_review_items)) task.needs_review_items = row.needs_review_items as string[];
    if (typeof row.auto_clear_forbidden === "boolean" && row.auto_clear_forbidden)
      task.auto_clear_forbidden = true;
    if (row.last_linked_at) task.last_linked_at = row.last_linked_at as string;
    // SPEC-BIE-COMMITTEE-EVIDENCE-REVIEW-ACTIONS-1: surface persisted review state.
    if (row.review_status) task.review_status = row.review_status as string;
    if (row.reviewed_by) task.reviewed_by = row.reviewed_by as string;
    if (row.reviewed_at) task.reviewed_at = row.reviewed_at as string;
    if (row.review_note) task.review_note = row.review_note as string;
    if (row.review_reason) task.review_reason = row.review_reason as string;
    if (typeof row.committee_grade_accepted === "boolean")
      task.committee_grade_accepted = row.committee_grade_accepted;
    return task;
  });
}

/**
 * SPEC-BIE-PERSIST-COMMITTEE-EVIDENCE-TASK-STATUS-1: persist the durable
 * enrichment columns for each enriched task. Idempotent (same inputs → same
 * values, only timestamps move). Never writes the banker workflow `status`, so
 * a committee blocker is never auto-cleared. Returns the number of rows written.
 */
export async function persistEnrichedCommitteeTasks(
  sb: SupabaseAdmin,
  enriched: CommitteeEvidenceTask[],
): Promise<number> {
  const now = new Date().toISOString();
  let written = 0;
  await Promise.all(
    (enriched ?? []).map(async (t) => {
      if (!t.id) return;
      const row = buildCommitteeTaskPersistRow(t, now);
      const { error } = await sb
        .from("buddy_research_committee_tasks")
        .update({ ...row, updated_at: now })
        .eq("id", t.id);
      if (!error) written += 1;
    }),
  );
  return written;
}

/**
 * Load committee tasks for a mission, re-link each to the current loan file
 * (documents / facts / story / management / research claims), persist the
 * derived enrichment, and return the freshly enriched tasks. Persistence is
 * non-fatal: enrichment is still returned if the write fails. Idempotent.
 */
export async function enrichAndPersistCommitteeTasks(
  sb: SupabaseAdmin,
  missionId: string,
  dealId: string,
): Promise<CommitteeEvidenceTask[]> {
  const tasks = await loadCommitteeTasks(sb, missionId);
  if (tasks.length === 0) return [];

  const [missionRes, evRes, docsRes, factsRes, storyRes, mgmtRes] = await Promise.all([
    sb.from("buddy_research_missions").select("subject").eq("id", missionId).maybeSingle(),
    sb.from("buddy_research_evidence")
      .select("id, section, thread_origin, evidence_type, claim, confidence, source_uris, source_types")
      .eq("mission_id", missionId),
    sb.from("deal_documents")
      .select("id, canonical_type, document_type, original_filename, status")
      .eq("deal_id", dealId).neq("is_active", false),
    sb.from("deal_financial_facts").select("fact_key, fact_type").eq("deal_id", dealId).neq("is_superseded", true),
    sb.from("deal_borrower_story")
      .select("products_services, customer_concentration, competitive_position, website")
      .eq("deal_id", dealId).maybeSingle(),
    sb.from("deal_management_profiles").select("id, person_name, title, source").eq("deal_id", dealId),
  ]);

  const subject = ((missionRes.data as any)?.subject ?? null) as { website?: string | null } | null;
  const enriched = enrichCommitteeTasks(tasks, {
    evidenceRows: (evRes.data as any) ?? [],
    documents: docsRes.data ?? [],
    financialFacts: factsRes.data ?? [],
    borrowerStory: storyRes.data ?? null,
    managementProfiles: mgmtRes.data ?? [],
    subject: subject ? { website: subject.website ?? null } : null,
  });

  try {
    await persistEnrichedCommitteeTasks(sb, enriched);
  } catch (err: any) {
    console.warn("[committeeEvidence] persistEnrichedCommitteeTasks failed (non-fatal):", err?.message);
  }
  return enriched;
}
