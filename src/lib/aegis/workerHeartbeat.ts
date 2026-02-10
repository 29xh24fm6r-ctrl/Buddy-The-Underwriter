import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AegisWorkerHeartbeat } from "./types";

function getEnv(): string {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return process.env.NODE_ENV ?? "development";
}

/**
 * Upsert worker heartbeat. Called at start of each worker tick.
 * Never throws.
 */
export async function sendHeartbeat(
  hb: AegisWorkerHeartbeat,
): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const now = new Date().toISOString();

    await sb.from("buddy_workers" as any).upsert(
      {
        id: hb.workerId,
        worker_type: hb.workerType,
        status: hb.status ?? "alive",
        last_heartbeat_at: now,
        jobs_processed: hb.jobsProcessed ?? 0,
        jobs_failed: hb.jobsFailed ?? 0,
        consecutive_failures: hb.consecutiveFailures ?? 0,
        last_error_message: hb.lastError ?? null,
        last_error_at: hb.lastError ? now : null,
        env: getEnv(),
        release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        updated_at: now,
      } as any,
      { onConflict: "id" },
    );
  } catch (err) {
    console.warn("[aegis.heartbeat] failed:", err);
  }
}

/**
 * Record a job completion — increment counters on the worker row.
 * Resets consecutive_failures on success.
 * Never throws.
 */
export async function recordJobCompletion(
  workerId: string,
  failed: boolean,
): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const now = new Date().toISOString();

    const { data } = await sb
      .from("buddy_workers" as any)
      .select("jobs_processed, jobs_failed, consecutive_failures")
      .eq("id", workerId)
      .maybeSingle();

    if (!data) return;

    const row = data as any;
    await sb
      .from("buddy_workers" as any)
      .update({
        jobs_processed: (row.jobs_processed ?? 0) + 1,
        jobs_failed: failed ? (row.jobs_failed ?? 0) + 1 : row.jobs_failed,
        consecutive_failures: failed
          ? (row.consecutive_failures ?? 0) + 1
          : 0,
        last_job_at: now,
        ...(failed ? { last_error_at: now } : {}),
        updated_at: now,
      } as any)
      .eq("id", workerId);
  } catch (err) {
    console.warn("[aegis.recordJobCompletion] failed:", err);
  }
}
