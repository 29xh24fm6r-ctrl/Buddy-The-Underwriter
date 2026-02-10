import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeSystemEvent } from "./writeSystemEvent";
import type { SpreadsIntelligenceResult } from "./types";

/* ------------------------------------------------------------------ */
/*  Thresholds (tunable)                                               */
/* ------------------------------------------------------------------ */

const GENERATING_WARNING_MIN = 10;
const GENERATING_CRITICAL_MIN = 60;
const ORPHAN_LEASE_THRESHOLD_MIN = 15;
const WORKER_HEARTBEAT_STALE_SEC = 60;
const SNAPSHOT_BLOCKED_STALE_MIN = 15;
const RECENT_409_WINDOW_MIN = 30;

/* ------------------------------------------------------------------ */
/*  Orchestrator                                                       */
/* ------------------------------------------------------------------ */

/**
 * Spreads Intelligence Layer — called as Phase 2 of observer tick.
 *
 * Each invariant is independently try/caught so one failure
 * does not block others. Runs sequentially because Section 1
 * auto-heals may affect Section 3 results.
 */
export async function runSpreadsIntelligence(): Promise<{
  result: SpreadsIntelligenceResult;
  errors: string[];
}> {
  const sb = supabaseAdmin();
  const errors: string[] = [];
  const result: SpreadsIntelligenceResult = {
    spreads_generating_timeout: 0,
    spreads_auto_healed: 0,
    spread_jobs_orphaned: 0,
    snapshot_blocked_deals: 0,
    stale_spread_status_detected: 0,
    failed_spread_jobs_linked: 0,
  };

  await checkSpreadGeneratingTimeout(sb, result, errors);
  await checkSpreadJobOrphans(sb, result, errors);
  await checkSnapshotBlockedByStaleSpreads(sb, result, errors);
  await run409IntelligencePass(sb, result, errors);

  return { result, errors };
}

/* ------------------------------------------------------------------ */
/*  Section 1: spread_generating_timeout                               */
/* ------------------------------------------------------------------ */

/**
 * Detect deal_spreads stuck in "generating" status.
 * WARNING at 10min, CRITICAL at 60min.
 * Auto-heal at 60min: set status to "error" so pipeline can retry.
 */
async function checkSpreadGeneratingTimeout(
  sb: ReturnType<typeof supabaseAdmin>,
  result: SpreadsIntelligenceResult,
  errors: string[],
): Promise<void> {
  try {
    const warningCutoff = new Date(
      Date.now() - GENERATING_WARNING_MIN * 60_000,
    ).toISOString();

    const { data: stuckSpreads, error } = await sb
      .from("deal_spreads" as any)
      .select("id, deal_id, bank_id, spread_type, status, updated_at")
      .eq("status", "generating")
      .lt("updated_at", warningCutoff);

    if (error) {
      errors.push(`spread_generating_timeout: ${error.message}`);
      return;
    }

    for (const spread of (stuckSpreads ?? []) as any[]) {
      const updatedAt = new Date(spread.updated_at).getTime();
      const minutesStuck = (Date.now() - updatedAt) / 60_000;
      const isCritical = minutesStuck >= GENERATING_CRITICAL_MIN;

      result.spreads_generating_timeout++;

      if (isCritical) {
        await sb
          .from("deal_spreads" as any)
          .update({
            status: "error",
            error: `[observer] stuck in generating for ${Math.round(minutesStuck)} minutes — auto-healed`,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", spread.id);

        result.spreads_auto_healed++;
      }

      writeSystemEvent({
        event_type: "stuck_job",
        severity: isCritical ? "critical" : "warning",
        source_system: "observer",
        deal_id: spread.deal_id,
        bank_id: spread.bank_id,
        error_class: "timeout",
        error_message: `Spread ${spread.spread_type} stuck in "generating" for ${Math.round(minutesStuck)} minutes${isCritical ? " — auto-healed to error" : ""}`,
        resolution_status: isCritical ? "resolved" : "open",
        ...(isCritical
          ? {
              resolved_at: new Date().toISOString(),
              resolved_by: "observer",
              resolution_note:
                "Auto-healed: status set to error after 60min timeout",
            }
          : {}),
        payload: {
          invariant: "spread_generating_timeout",
          spread_id: spread.id,
          spread_type: spread.spread_type,
          minutes_stuck: Math.round(minutesStuck),
          auto_healed: isCritical,
        },
      }).catch(() => {});
    }
  } catch (err: any) {
    errors.push(`spread_generating_timeout: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Section 2: spread_job_orphan_check                                 */
/* ------------------------------------------------------------------ */

/**
 * Detect deal_spread_jobs with expired leases where
 * the lease_owner worker heartbeat is stale (>60s) or missing.
 * Re-queue orphaned jobs.
 *
 * Uses 15min threshold (vs Phase 1's 10min) to avoid double-processing.
 */
async function checkSpreadJobOrphans(
  sb: ReturnType<typeof supabaseAdmin>,
  result: SpreadsIntelligenceResult,
  errors: string[],
): Promise<void> {
  try {
    const orphanCutoff = new Date(
      Date.now() - ORPHAN_LEASE_THRESHOLD_MIN * 60_000,
    ).toISOString();

    const { data: candidateJobs, error } = await sb
      .from("deal_spread_jobs" as any)
      .select(
        "id, deal_id, bank_id, lease_owner, leased_until, updated_at, attempt",
      )
      .eq("status", "RUNNING")
      .lt("leased_until", new Date().toISOString())
      .lt("updated_at", orphanCutoff);

    if (error) {
      errors.push(`spread_job_orphan_check: ${error.message}`);
      return;
    }

    if (!candidateJobs || candidateJobs.length === 0) return;

    // Gather unique lease_owners to check heartbeats
    const leaseOwners = [
      ...new Set(
        (candidateJobs as any[])
          .map((j) => j.lease_owner)
          .filter(Boolean) as string[],
      ),
    ];

    const staleWorkerCutoff = new Date(
      Date.now() - WORKER_HEARTBEAT_STALE_SEC * 1000,
    ).toISOString();

    const { data: workers } = leaseOwners.length > 0
      ? await sb
          .from("buddy_workers" as any)
          .select("id, last_heartbeat_at, status")
          .in("id", leaseOwners)
      : { data: [] };

    const staleWorkerIds = new Set<string>();
    for (const w of (workers ?? []) as any[]) {
      if (w.status === "dead" || w.last_heartbeat_at < staleWorkerCutoff) {
        staleWorkerIds.add(w.id);
      }
    }
    // Workers not found in buddy_workers are also considered stale
    for (const owner of leaseOwners) {
      if (!(workers ?? []).some((w: any) => w.id === owner)) {
        staleWorkerIds.add(owner);
      }
    }

    for (const job of candidateJobs as any[]) {
      if (!job.lease_owner || !staleWorkerIds.has(job.lease_owner)) continue;

      result.spread_jobs_orphaned++;

      await sb
        .from("deal_spread_jobs" as any)
        .update({
          status: "QUEUED",
          leased_until: null,
          lease_owner: null,
          error: `[observer] orphaned — lease expired, worker ${job.lease_owner} stale`,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", job.id);

      writeSystemEvent({
        event_type: "lease_expired",
        severity: "warning",
        source_system: "observer",
        source_job_id: job.id,
        source_job_table: "deal_spread_jobs",
        deal_id: job.deal_id,
        bank_id: job.bank_id,
        error_class: "timeout",
        error_message: `Spread job orphaned: lease expired, worker ${job.lease_owner} heartbeat stale`,
        resolution_status: "retrying",
        payload: {
          invariant: "spread_job_orphan_check",
          lease_owner: job.lease_owner,
          leased_until: job.leased_until,
          attempt: job.attempt,
        },
      }).catch(() => {});
    }
  } catch (err: any) {
    errors.push(`spread_job_orphan_check: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Section 3: snapshot_blocked_by_stale_spreads                       */
/* ------------------------------------------------------------------ */

/**
 * Detect deals where snapshot is blocked because spreads have been
 * stuck in "generating" for >15min AND there are recent snapshot 409s.
 */
async function checkSnapshotBlockedByStaleSpreads(
  sb: ReturnType<typeof supabaseAdmin>,
  result: SpreadsIntelligenceResult,
  errors: string[],
): Promise<void> {
  try {
    const staleCutoff = new Date(
      Date.now() - SNAPSHOT_BLOCKED_STALE_MIN * 60_000,
    ).toISOString();

    const { data: staleSpreads, error } = await sb
      .from("deal_spreads" as any)
      .select("deal_id, bank_id, spread_type, updated_at")
      .eq("status", "generating")
      .lt("updated_at", staleCutoff);

    if (error) {
      errors.push(`snapshot_blocked_by_stale_spreads: ${error.message}`);
      return;
    }
    if (!staleSpreads || staleSpreads.length === 0) return;

    // Deduplicate by deal_id
    const dealMap = new Map<
      string,
      { bank_id: string; spread_types: string[]; oldest_updated_at: string }
    >();
    for (const s of staleSpreads as any[]) {
      const existing = dealMap.get(s.deal_id);
      if (existing) {
        existing.spread_types.push(s.spread_type);
        if (s.updated_at < existing.oldest_updated_at) {
          existing.oldest_updated_at = s.updated_at;
        }
      } else {
        dealMap.set(s.deal_id, {
          bank_id: s.bank_id,
          spread_types: [s.spread_type],
          oldest_updated_at: s.updated_at,
        });
      }
    }

    const recentCutoff = new Date(
      Date.now() - RECENT_409_WINDOW_MIN * 60_000,
    ).toISOString();

    for (const [dealId, info] of dealMap) {
      const { data: recentFailures } = await sb
        .from("deal_pipeline_ledger" as any)
        .select("id, created_at, meta")
        .eq("deal_id", dealId)
        .eq("event_key", "snapshot.run.failed")
        .gte("created_at", recentCutoff)
        .order("created_at", { ascending: false })
        .limit(3);

      const has409 = (recentFailures ?? []).some(
        (e: any) => e.meta?.reason === "SPREADS_IN_PROGRESS",
      );

      if (!has409) continue;

      result.snapshot_blocked_deals++;

      const minutesStale = Math.round(
        (Date.now() - new Date(info.oldest_updated_at).getTime()) / 60_000,
      );

      writeSystemEvent({
        event_type: "warning",
        severity: "warning",
        source_system: "observer",
        deal_id: dealId,
        bank_id: info.bank_id,
        error_class: "timeout",
        error_message: `Snapshot blocked by stale spreads (${info.spread_types.join(", ")}) generating for ${minutesStale} minutes`,
        resolution_status: "open",
        payload: {
          invariant: "snapshot_blocked_by_stale_spreads",
          snapshot_blocked: true,
          spread_types: info.spread_types,
          recent_409_count: (recentFailures ?? []).filter(
            (e: any) => e.meta?.reason === "SPREADS_IN_PROGRESS",
          ).length,
          minutes_stale: minutesStale,
        },
      }).catch(() => {});
    }
  } catch (err: any) {
    errors.push(`snapshot_blocked_by_stale_spreads: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Section 4: 409 Intelligence Pass                                   */
/* ------------------------------------------------------------------ */

/**
 * "Second opinion" pass for deals recently 409'd on snapshot recompute.
 * Catches edge cases:
 *   A) All spread jobs SUCCEEDED but deal_spreads still "generating" (stale status)
 *   B) Spread jobs FAILED but nobody noticed
 */
async function run409IntelligencePass(
  sb: ReturnType<typeof supabaseAdmin>,
  result: SpreadsIntelligenceResult,
  errors: string[],
): Promise<void> {
  try {
    const recentCutoff = new Date(
      Date.now() - RECENT_409_WINDOW_MIN * 60_000,
    ).toISOString();

    const { data: recent409s, error } = await sb
      .from("deal_pipeline_ledger" as any)
      .select("deal_id, bank_id, created_at, meta")
      .eq("event_key", "snapshot.run.failed")
      .gte("created_at", recentCutoff)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      errors.push(`409_intelligence_pass: ${error.message}`);
      return;
    }

    // Filter to SPREADS_IN_PROGRESS 409s, deduplicate by deal_id
    const dealBankMap = new Map<string, string>();
    for (const evt of (recent409s ?? []) as any[]) {
      if (
        evt.meta?.reason === "SPREADS_IN_PROGRESS" &&
        !dealBankMap.has(evt.deal_id)
      ) {
        dealBankMap.set(evt.deal_id, evt.bank_id);
      }
    }

    if (dealBankMap.size === 0) return;

    for (const [dealId, bankId] of dealBankMap) {
      const [{ data: spreadJobs }, { data: spreads }] = await Promise.all([
        sb
          .from("deal_spread_jobs" as any)
          .select("id, status, error, updated_at")
          .eq("deal_id", dealId)
          .eq("bank_id", bankId),
        sb
          .from("deal_spreads" as any)
          .select("id, spread_type, status, updated_at")
          .eq("deal_id", dealId)
          .eq("bank_id", bankId),
      ]);

      const jobs = (spreadJobs ?? []) as any[];
      const spreadRows = (spreads ?? []) as any[];

      const allJobsSucceeded =
        jobs.length > 0 && jobs.every((j) => j.status === "SUCCEEDED");
      const anyJobFailed = jobs.some((j) => j.status === "FAILED");
      const anySpreadsGenerating = spreadRows.some(
        (s) => s.status === "generating",
      );

      // Case A: All jobs SUCCEEDED but spread still "generating"
      if (allJobsSucceeded && anySpreadsGenerating) {
        result.stale_spread_status_detected++;

        writeSystemEvent({
          event_type: "error",
          severity: "critical",
          source_system: "observer",
          deal_id: dealId,
          bank_id: bankId,
          error_class: "permanent",
          error_message: `Stale spread status: all ${jobs.length} spread jobs SUCCEEDED but deal_spreads still "generating"`,
          resolution_status: "open",
          payload: {
            invariant: "409_intelligence_stale_spread",
            all_jobs_succeeded: true,
            generating_spreads: spreadRows
              .filter((s) => s.status === "generating")
              .map((s) => ({ id: s.id, type: s.spread_type })),
            job_count: jobs.length,
          },
        }).catch(() => {});
      }

      // Case B: Some jobs FAILED → link 409 to the failed job
      if (anyJobFailed) {
        const failedJobs = jobs.filter((j) => j.status === "FAILED");
        result.failed_spread_jobs_linked++;

        writeSystemEvent({
          event_type: "error",
          severity: "error",
          source_system: "observer",
          deal_id: dealId,
          bank_id: bankId,
          error_class: "permanent",
          error_message: `Snapshot 409 caused by ${failedJobs.length} failed spread job(s): ${failedJobs.map((j) => j.error?.slice(0, 100)).join("; ")}`,
          resolution_status: "open",
          payload: {
            invariant: "409_intelligence_failed_jobs",
            failed_jobs: failedJobs.map((j) => ({
              id: j.id,
              error: j.error?.slice(0, 200),
            })),
            snapshot_409_deal: dealId,
          },
        }).catch(() => {});
      }
    }
  } catch (err: any) {
    errors.push(`409_intelligence_pass: ${err.message}`);
  }
}
