/**
 * BRIE Runtime — Buddy Resumable Intelligence Engine (Phase 66A)
 *
 * Wraps the existing runMission pipeline with:
 * - Checkpoint/resume capability
 * - Per-stage thread tracking
 * - Failure library integration
 * - Heartbeat monitoring
 * - Retry with exponential backoff
 *
 * BRIE wraps — it does NOT replace runMission.
 * The canonical path remains: runMission → buddy_research_missions → BIE → memo
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MissionType, MissionSubject, MissionDepth, MissionExecutionResult } from "./types";
import { generateRunKey, checkExistingMission, DEFAULT_RETRY_CONFIG, getRetryDelay, isRetryableError } from "./orchestration";
import { saveCheckpoint, getResumeDecision, sendHeartbeat, type CheckpointStage } from "./checkpoint";
import { createThreadRun, completeThreadRun, failThreadRun } from "./threadRuns";
import { recordFailure } from "./failureLibrary";

// ============================================================================
// Constants
// ============================================================================

const BRIE_VERSION = "1.0.0";
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

// ============================================================================
// Types
// ============================================================================

export type BrieOptions = {
  dealId: string;
  bankId: string;
  missionType: MissionType;
  subject: MissionSubject;
  depth?: MissionDepth;
  userId?: string;
  forceRerun?: boolean;
  maxAttempts?: number;
};

export type BrieResult = {
  ok: boolean;
  mission_id?: string;
  skipped?: boolean;
  skippedReason?: string;
  resumed?: boolean;
  resumedFromStage?: string;
  attempts: number;
  duration_ms: number;
  error?: string;
};

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Execute a research mission through the BRIE runtime.
 *
 * 1. Checks idempotency via run key
 * 2. Checks for resumable checkpoint
 * 3. Runs mission stages with per-stage tracking
 * 4. Saves checkpoints between stages
 * 5. Records failures in the failure library
 * 6. Retries retryable errors with backoff
 */
export async function executeBrieMission(
  sb: SupabaseClient,
  opts: BrieOptions,
  /** Injected mission runner — keeps BRIE decoupled from runMission internals */
  runMission: (
    dealId: string,
    missionType: MissionType,
    subject: MissionSubject,
    options: { depth: MissionDepth; bankId: string; userId?: string; resumeFromStage?: CheckpointStage },
  ) => Promise<MissionExecutionResult>,
): Promise<BrieResult> {
  const startedAt = Date.now();
  const depth = opts.depth ?? "committee";
  const maxAttempts = opts.maxAttempts ?? DEFAULT_RETRY_CONFIG.max_attempts;

  // 1. Idempotency check
  const runKey = generateRunKey({
    deal_id: opts.dealId,
    mission_type: opts.missionType,
    subject: opts.subject,
    depth,
  });

  const existing = await checkExistingMission(sb, opts.dealId, runKey, opts.forceRerun ?? false);
  if (existing.skip) {
    return {
      ok: true,
      mission_id: existing.existingMissionId,
      skipped: true,
      skippedReason: "duplicate_run_key",
      attempts: 0,
      duration_ms: Date.now() - startedAt,
    };
  }

  // 2. Check for resumable checkpoint (if mission was previously started)
  let resumeFromStage: CheckpointStage | undefined;
  let resumed = false;

  // Look for a failed mission with the same run key that has checkpoints
  const { data: failedMission } = await sb
    .from("buddy_research_missions")
    .select("id")
    .eq("deal_id", opts.dealId)
    .eq("run_key", runKey)
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (failedMission) {
    const decision = await getResumeDecision(sb, failedMission.id);
    if (decision.shouldResume && decision.resumeFromStage) {
      resumeFromStage = decision.resumeFromStage;
      resumed = true;

      // Update the failed mission to running for retry
      await sb
        .from("buddy_research_missions")
        .update({
          status: "running",
          attempt_count: (await getMissionAttemptCount(sb, failedMission.id)) + 1,
          orchestrator_version: BRIE_VERSION,
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq("id", failedMission.id);
    }
  }

  // 3. Execute with retry
  let lastError: string | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Start heartbeat
    const heartbeatTimer = setInterval(() => {
      // Fire-and-forget heartbeat
      void sendHeartbeat(sb, failedMission?.id ?? "pending");
    }, HEARTBEAT_INTERVAL_MS);

    try {
      const result = await runMission(
        opts.dealId,
        opts.missionType,
        opts.subject,
        {
          depth,
          bankId: opts.bankId,
          userId: opts.userId,
          resumeFromStage,
        },
      );

      clearInterval(heartbeatTimer);

      if (result.ok) {
        return {
          ok: true,
          mission_id: result.mission_id,
          resumed,
          resumedFromStage: resumeFromStage,
          attempts: attempt + 1,
          duration_ms: Date.now() - startedAt,
        };
      }

      // Mission returned ok: false — record failure
      lastError = result.error;
      await recordFailure(sb, {
        error: result.error ?? "Mission returned ok: false",
        mission_id: result.mission_id,
        mission_type: opts.missionType,
      });

    } catch (err: unknown) {
      clearInterval(heartbeatTimer);
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error.message;

      await recordFailure(sb, {
        error,
        mission_type: opts.missionType,
      });

      if (!isRetryableError(error) || attempt === maxAttempts - 1) {
        break;
      }

      // Wait before retry
      const delay = getRetryDelay(attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return {
    ok: false,
    resumed,
    attempts: maxAttempts,
    duration_ms: Date.now() - startedAt,
    error: lastError,
  };
}

// ============================================================================
// Helpers
// ============================================================================

async function getMissionAttemptCount(sb: SupabaseClient, missionId: string): Promise<number> {
  const { data } = await sb
    .from("buddy_research_missions")
    .select("attempt_count")
    .eq("id", missionId)
    .single();
  return data?.attempt_count ?? 1;
}

// ============================================================================
// Stage Wrappers (for use inside runMission stages)
// ============================================================================

/**
 * Wrap a mission stage execution with thread tracking and checkpointing.
 * Use this inside individual stages of runMission to get automatic tracking.
 */
export async function withStageTracking<T>(
  sb: SupabaseClient,
  missionId: string,
  stage: CheckpointStage,
  fn: () => Promise<T>,
  opts?: {
    inputSummary?: Record<string, unknown>;
    getItemCounts?: (result: T) => { processed: number; failed: number };
    getCheckpointState?: (result: T) => Record<string, unknown>;
  },
): Promise<T> {
  const threadRunId = await createThreadRun(sb, missionId, stage, 0, opts?.inputSummary);

  try {
    const result = await fn();

    const counts = opts?.getItemCounts?.(result) ?? { processed: 0, failed: 0 };

    if (threadRunId) {
      await completeThreadRun(sb, threadRunId, {
        items_processed: counts.processed,
        items_failed: counts.failed,
      });
    }

    // Save checkpoint after successful stage
    if (opts?.getCheckpointState) {
      await saveCheckpoint(sb, {
        mission_id: missionId,
        stage,
        state_json: opts.getCheckpointState(result),
      });
    }

    return result;
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));

    if (threadRunId) {
      await failThreadRun(sb, threadRunId, {
        message: error.message,
        retryable: isRetryableError(error),
      });
    }

    throw err;
  }
}
