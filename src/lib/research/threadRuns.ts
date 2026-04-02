/**
 * Thread Run Tracking — Phase 66A
 *
 * Tracks per-stage execution within a mission.
 * Each stage (source_discovery, fact_extraction, etc.) gets its own
 * thread_run record with timing, item counts, and error details.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckpointStage } from "./checkpoint";

// ============================================================================
// Types
// ============================================================================

export type ThreadRunStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export type ThreadRun = {
  id: string;
  mission_id: string;
  stage: CheckpointStage;
  thread_index: number;
  status: ThreadRunStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  input_summary: Record<string, unknown> | null;
  output_summary: Record<string, unknown> | null;
  items_processed: number;
  items_failed: number;
  error_message: string | null;
  error_code: string | null;
  retryable: boolean;
  created_at: string;
};

// ============================================================================
// Create Thread Run
// ============================================================================

/**
 * Create a new thread run record for a mission stage.
 */
export async function createThreadRun(
  sb: SupabaseClient,
  missionId: string,
  stage: CheckpointStage,
  threadIndex: number = 0,
  inputSummary?: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await sb
    .from("buddy_research_thread_runs")
    .insert({
      mission_id: missionId,
      stage,
      thread_index: threadIndex,
      status: "running",
      started_at: new Date().toISOString(),
      input_summary: inputSummary ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[threadRuns] create failed", { missionId, stage, error });
    return null;
  }

  return data.id;
}

// ============================================================================
// Complete Thread Run
// ============================================================================

/**
 * Mark a thread run as complete with output summary.
 */
export async function completeThreadRun(
  sb: SupabaseClient,
  threadRunId: string,
  result: {
    items_processed: number;
    items_failed?: number;
    output_summary?: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date().toISOString();

  // Get started_at for duration calculation
  const { data: run } = await sb
    .from("buddy_research_thread_runs")
    .select("started_at")
    .eq("id", threadRunId)
    .single();

  const durationMs = run?.started_at
    ? Date.now() - new Date(run.started_at).getTime()
    : null;

  await sb
    .from("buddy_research_thread_runs")
    .update({
      status: "complete",
      completed_at: now,
      duration_ms: durationMs,
      items_processed: result.items_processed,
      items_failed: result.items_failed ?? 0,
      output_summary: result.output_summary ?? null,
    })
    .eq("id", threadRunId);
}

// ============================================================================
// Fail Thread Run
// ============================================================================

/**
 * Mark a thread run as failed with error details.
 */
export async function failThreadRun(
  sb: SupabaseClient,
  threadRunId: string,
  error: {
    message: string;
    code?: string;
    retryable?: boolean;
    items_processed?: number;
  },
): Promise<void> {
  const now = new Date().toISOString();

  const { data: run } = await sb
    .from("buddy_research_thread_runs")
    .select("started_at")
    .eq("id", threadRunId)
    .single();

  const durationMs = run?.started_at
    ? Date.now() - new Date(run.started_at).getTime()
    : null;

  await sb
    .from("buddy_research_thread_runs")
    .update({
      status: "failed",
      completed_at: now,
      duration_ms: durationMs,
      error_message: error.message,
      error_code: error.code ?? null,
      retryable: error.retryable ?? false,
      items_processed: error.items_processed ?? 0,
    })
    .eq("id", threadRunId);
}

// ============================================================================
// Query Thread Runs
// ============================================================================

/**
 * Get all thread runs for a mission, ordered by stage then thread index.
 */
export async function getThreadRuns(
  sb: SupabaseClient,
  missionId: string,
): Promise<ThreadRun[]> {
  const { data } = await sb
    .from("buddy_research_thread_runs")
    .select("*")
    .eq("mission_id", missionId)
    .order("created_at", { ascending: true });

  return (data ?? []) as ThreadRun[];
}
