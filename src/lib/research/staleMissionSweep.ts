/**
 * Stale Research Mission Sweep
 *
 * FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1): findStaleMissions()
 * (checkpoint.ts) has existed for a while but nothing ever called it — a
 * mission killed mid-flight (platform timeout, process crash outside the
 * runMission() try/catch) was left at status="running" forever, with no
 * sweep to recover it and no dead-letter/failed signal for operators or the
 * banker UI to key off. This wires it into the existing worker-tick job so
 * stuck missions get flipped to "failed" on a regular cadence instead of
 * staying wedged indefinitely.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { findStaleMissions } from "./checkpoint";
import { writeDegradedQualityGate } from "./runMission";

const DEFAULT_STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes — headroom above the 5-min BIE route maxDuration

export type StaleMissionSweepResult = {
  ok: boolean;
  stale_found: number;
  recovered: number;
  errors: string[];
};

/**
 * Find missions stuck at status="running" past the staleness threshold and
 * flip them to "failed" with a descriptive error_message, plus an
 * unconditional degraded quality-gate row so the failure is queryable the
 * same way a BIE/trust-layer exception is (see writeDegradedQualityGate).
 * Never throws — this is a best-effort recovery sweep, not a critical path.
 */
export async function sweepStaleResearchMissions(
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): Promise<StaleMissionSweepResult> {
  const sb = supabaseAdmin();
  const errors: string[] = [];

  let staleIds: string[] = [];
  try {
    staleIds = await findStaleMissions(sb, staleThresholdMs);
  } catch (e: any) {
    return { ok: false, stale_found: 0, recovered: 0, errors: [e?.message ?? "findStaleMissions failed"] };
  }

  if (staleIds.length === 0) {
    return { ok: true, stale_found: 0, recovered: 0, errors: [] };
  }

  let recovered = 0;
  for (const missionId of staleIds) {
    try {
      const { data: mission } = await sb
        .from("buddy_research_missions")
        .select("id, deal_id, status")
        .eq("id", missionId)
        .maybeSingle();

      // Re-check status — the mission may have completed/failed between the
      // findStaleMissions read and this update (no lock is held across them).
      if (!mission || mission.status !== "running") continue;

      const { error } = await sb
        .from("buddy_research_missions")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: `stale_mission_sweep: no progress for >${Math.round(staleThresholdMs / 60_000)}min — likely killed by a platform timeout or process crash mid-run`,
        })
        .eq("id", missionId)
        .eq("status", "running"); // only flip if still running (race guard)

      if (error) {
        errors.push(`${missionId}: ${error.message}`);
        continue;
      }

      await writeDegradedQualityGate(
        missionId,
        mission.deal_id,
        "stale_mission_sweep",
        `Mission auto-failed by stale-mission sweep after no progress for >${Math.round(staleThresholdMs / 60_000)}min`,
      );

      recovered++;
    } catch (e: any) {
      errors.push(`${missionId}: ${e?.message ?? "unknown error"}`);
    }
  }

  return { ok: errors.length === 0, stale_found: staleIds.length, recovered, errors };
}
