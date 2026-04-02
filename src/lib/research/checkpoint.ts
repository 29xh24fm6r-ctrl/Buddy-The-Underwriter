/**
 * BRIE Checkpoint System — Phase 66A
 *
 * Provides resumable state snapshots for research missions.
 * Checkpoints are saved per-stage so a failed mission can resume
 * from the last successful stage instead of starting over.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Types
// ============================================================================

export type CheckpointStage =
  | "source_discovery"
  | "source_ingestion"
  | "fact_extraction"
  | "inference_derivation"
  | "narrative_compilation"
  | "bie_enrichment"
  | "gap_analysis"
  | "flag_bridging";

export type Checkpoint = {
  id: string;
  mission_id: string;
  stage: CheckpointStage;
  sequence_number: number;
  state_json: Record<string, unknown>;
  completed_source_ids: string[];
  completed_fact_ids: string[];
  pending_work_json: Record<string, unknown> | null;
  created_at: string;
  byte_size: number | null;
};

export type SaveCheckpointInput = {
  mission_id: string;
  stage: CheckpointStage;
  state_json: Record<string, unknown>;
  completed_source_ids?: string[];
  completed_fact_ids?: string[];
  pending_work_json?: Record<string, unknown>;
};

// ============================================================================
// Save Checkpoint
// ============================================================================

/**
 * Save a checkpoint for a mission stage.
 * Uses upsert on (mission_id, stage, sequence_number) to allow overwrites.
 */
export async function saveCheckpoint(
  sb: SupabaseClient,
  input: SaveCheckpointInput,
): Promise<{ ok: boolean; checkpoint_id?: string; error?: string }> {
  const stateStr = JSON.stringify(input.state_json);
  const byteSize = new TextEncoder().encode(stateStr).length;

  // Get next sequence number for this stage
  const { data: existing } = await sb
    .from("buddy_research_checkpoints")
    .select("sequence_number")
    .eq("mission_id", input.mission_id)
    .eq("stage", input.stage)
    .order("sequence_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSeq = (existing?.sequence_number ?? -1) + 1;

  const { data, error } = await sb
    .from("buddy_research_checkpoints")
    .insert({
      mission_id: input.mission_id,
      stage: input.stage,
      sequence_number: nextSeq,
      state_json: input.state_json,
      completed_source_ids: input.completed_source_ids ?? [],
      completed_fact_ids: input.completed_fact_ids ?? [],
      pending_work_json: input.pending_work_json ?? null,
      byte_size: byteSize,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[checkpoint] save failed", { mission_id: input.mission_id, stage: input.stage, error });
    return { ok: false, error: error.message };
  }

  // Update mission's resume pointer
  await sb
    .from("buddy_research_missions")
    .update({
      resume_from_checkpoint: data.id,
      current_stage: input.stage,
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq("id", input.mission_id);

  return { ok: true, checkpoint_id: data.id };
}

// ============================================================================
// Load Latest Checkpoint
// ============================================================================

/**
 * Load the most recent checkpoint for a mission, optionally for a specific stage.
 */
export async function loadLatestCheckpoint(
  sb: SupabaseClient,
  missionId: string,
  stage?: CheckpointStage,
): Promise<Checkpoint | null> {
  let query = sb
    .from("buddy_research_checkpoints")
    .select("*")
    .eq("mission_id", missionId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (stage) {
    query = query.eq("stage", stage);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("[checkpoint] load failed", { missionId, stage, error });
    return null;
  }

  return data as Checkpoint | null;
}

// ============================================================================
// Resume Decision
// ============================================================================

/** Ordered stages for determining resume point */
const STAGE_ORDER: CheckpointStage[] = [
  "source_discovery",
  "source_ingestion",
  "fact_extraction",
  "inference_derivation",
  "narrative_compilation",
  "bie_enrichment",
  "gap_analysis",
  "flag_bridging",
];

export type ResumeDecision = {
  shouldResume: boolean;
  resumeFromStage: CheckpointStage | null;
  checkpoint: Checkpoint | null;
  completedStages: CheckpointStage[];
};

/**
 * Determine where to resume a failed/interrupted mission.
 * Returns the stage to resume from and the checkpoint to restore.
 */
export async function getResumeDecision(
  sb: SupabaseClient,
  missionId: string,
): Promise<ResumeDecision> {
  const { data: checkpoints } = await sb
    .from("buddy_research_checkpoints")
    .select("*")
    .eq("mission_id", missionId)
    .order("created_at", { ascending: true });

  if (!checkpoints || checkpoints.length === 0) {
    return { shouldResume: false, resumeFromStage: null, checkpoint: null, completedStages: [] };
  }

  // Find all completed stages (those that have checkpoints)
  const completedStages = new Set<CheckpointStage>();
  for (const cp of checkpoints) {
    completedStages.add(cp.stage as CheckpointStage);
  }

  // Find the next stage after the last completed one
  let lastCompletedIndex = -1;
  for (const stage of STAGE_ORDER) {
    const idx = STAGE_ORDER.indexOf(stage);
    if (completedStages.has(stage) && idx > lastCompletedIndex) {
      lastCompletedIndex = idx;
    }
  }

  const nextStageIndex = lastCompletedIndex + 1;
  if (nextStageIndex >= STAGE_ORDER.length) {
    // All stages completed
    return {
      shouldResume: false,
      resumeFromStage: null,
      checkpoint: null,
      completedStages: Array.from(completedStages),
    };
  }

  // Get the latest checkpoint (for restoring state)
  const latestCheckpoint = checkpoints[checkpoints.length - 1] as Checkpoint;

  return {
    shouldResume: true,
    resumeFromStage: STAGE_ORDER[nextStageIndex],
    checkpoint: latestCheckpoint,
    completedStages: Array.from(completedStages),
  };
}

// ============================================================================
// Heartbeat
// ============================================================================

/**
 * Send a heartbeat for a running mission. Used to detect stale missions.
 */
export async function sendHeartbeat(
  sb: SupabaseClient,
  missionId: string,
): Promise<void> {
  await sb
    .from("buddy_research_missions")
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq("id", missionId);
}

/**
 * Find missions that appear stale (no heartbeat for > threshold).
 */
export async function findStaleMissions(
  sb: SupabaseClient,
  staleThresholdMs: number = 5 * 60 * 1000, // 5 minutes
): Promise<string[]> {
  const threshold = new Date(Date.now() - staleThresholdMs).toISOString();

  const { data } = await sb
    .from("buddy_research_missions")
    .select("id")
    .eq("status", "running")
    .lt("last_heartbeat_at", threshold);

  return (data ?? []).map((row) => row.id);
}
