import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeSystemEvent } from "./writeSystemEvent";
import { reconcileAegisFindingsForSpread } from "./reconcileSpreadFindings";
import type { SpreadsIntelligenceResult } from "./types";

/* ------------------------------------------------------------------ */
/*  Thresholds (tunable)                                               */
/* ------------------------------------------------------------------ */

const GENERATING_WARNING_MIN = 10;
const GENERATING_CRITICAL_MIN = 60;
/**
 * How many times a single spread row may be reset to "queued" by the auto-heal
 * before it is declared unrecoverable. Without a cap the observer resets the
 * row's updated_at every hour forever, so it is permanently "about to retry"
 * and the deal never finishes and never surfaces a terminal error.
 */
const MAX_AUTO_HEAL_ATTEMPTS = 3;
const ORPHAN_LEASE_THRESHOLD_MIN = 15;
const WORKER_HEARTBEAT_STALE_SEC = 60;
const SNAPSHOT_BLOCKED_STALE_MIN = 15;
const RECENT_409_WINDOW_MIN = 30;
const SNAPSHOT_422_WINDOW_MIN = 60;
const SNAPSHOT_422_MIN_FAILURES = 2;

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
    snapshot_recompute_422_deals: 0,
  };

  await checkSpreadGeneratingTimeout(sb, result, errors);
  await checkSpreadJobOrphans(sb, result, errors);
  await checkSnapshotBlockedByStaleSpreads(sb, result, errors);
  await run409IntelligencePass(sb, result, errors);
  await checkSnapshotRepeatedBlockedDeals(sb, result, errors);

  return { result, errors };
}

/* ------------------------------------------------------------------ */
/*  Section 1: spread_generating_timeout                               */
/* ------------------------------------------------------------------ */

/**
 * Detect deal_spreads stuck in "queued"/"generating" status.
 * WARNING at 10min, CRITICAL at 60min.
 *
 * Auto-heal at 60min: the row is auto-healed by resetting it to "queued" AND
 * enqueuing a spread job for it,
 * up to MAX_AUTO_HEAL_ATTEMPTS times; after that mark it error/
 * SPREAD_STUCK_UNRECOVERABLE. Resetting the row without enqueuing a job is not a
 * heal — the row simply goes stale again and is "healed" again an hour later.
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
      .select("id, deal_id, bank_id, spread_type, status, started_at, updated_at, error_details_json")
      .in("status", ["queued", "generating"])
      .lt("updated_at", warningCutoff);

    if (error) {
      errors.push(`spread_generating_timeout: ${error.message}`);
      return;
    }

    // Deals that had a spread reset to "queued" this pass. Resetting the row is
    // only half a heal — without a backing deal_spread_jobs row nothing will ever
    // pick it up, so the row just goes stale again and is "healed" on the next
    // tick, forever. Collect the targets and enqueue real work once per deal.
    const requeueByDeal = new Map<
      string,
      { dealId: string; bankId: string; spreadTypes: Set<string> }
    >();

    for (const spread of (stuckSpreads ?? []) as any[]) {
      const effectiveStart = spread.started_at ?? spread.updated_at;
      const minutesStuck = (Date.now() - new Date(effectiveStart).getTime()) / 60_000;
      const isCritical = minutesStuck >= GENERATING_CRITICAL_MIN;

      result.spreads_generating_timeout++;

      let healOutcome: "requeued" | "terminal" | null = null;

      if (isCritical) {
        const priorDetails =
          spread.error_details_json && typeof spread.error_details_json === "object"
            ? spread.error_details_json
            : {};
        const healCount =
          (typeof priorDetails.healCount === "number" ? priorDetails.healCount : 0) + 1;

        if (healCount > MAX_AUTO_HEAL_ATTEMPTS) {
          // Retrying has not worked. Fail closed on a terminal error rather than
          // resetting the clock again — an endlessly "retrying" spread is
          // indistinguishable from a working one in the UI, and the deal silently
          // never completes.
          await sb
            .from("deal_spreads" as any)
            .update({
              status: "error",
              finished_at: new Date().toISOString(),
              error: `[observer] still stuck after ${MAX_AUTO_HEAL_ATTEMPTS} auto-heal attempts — giving up`,
              error_code: "SPREAD_STUCK_UNRECOVERABLE",
              error_details_json: {
                ...priorDetails,
                minutesStuck: Math.round(minutesStuck),
                autoHealed: false,
                healCount,
                spreadId: spread.id,
              },
              updated_at: new Date().toISOString(),
            } as any)
            .eq("id", spread.id);

          healOutcome = "terminal";
        } else {
          // Reset to queued so spreads retry instead of dying permanently.
          // `attempts` is deliberately NOT zeroed — zeroing it destroys the only
          // record of how many times this row has already been through the loop.
          await sb
            .from("deal_spreads" as any)
            .update({
              status: "queued",
              finished_at: null,
              error: `[observer] reset after ${Math.round(minutesStuck)}min timeout — re-enqueued (attempt ${healCount}/${MAX_AUTO_HEAL_ATTEMPTS})`,
              error_code: null,
              error_details_json: {
                ...priorDetails,
                minutesStuck: Math.round(minutesStuck),
                autoHealed: true,
                healCount,
                spreadId: spread.id,
              },
              updated_at: new Date().toISOString(),
            } as any)
            .eq("id", spread.id);

          const dealKey = `${spread.deal_id}::${spread.bank_id}`;
          const entry = requeueByDeal.get(dealKey) ?? {
            dealId: String(spread.deal_id),
            bankId: String(spread.bank_id),
            spreadTypes: new Set<string>(),
          };
          entry.spreadTypes.add(String(spread.spread_type));
          requeueByDeal.set(dealKey, entry);

          healOutcome = "requeued";
        }

        result.spreads_auto_healed++;

        reconcileAegisFindingsForSpread({
          dealId: spread.deal_id,
          bankId: spread.bank_id,
          spreadType: spread.spread_type,
          newStatus: "error",
        }).catch(() => {});
      }

      // Dedup: skip warning event if open finding already exists for this spread+invariant
      if (!isCritical) {
        const { count: existingCount } = await sb
          .from("buddy_system_events" as any)
          .select("id", { count: "exact", head: true })
          .eq("deal_id", spread.deal_id)
          .eq("bank_id", spread.bank_id)
          .in("resolution_status", ["open", "retrying"])
          .in("event_type", ["stuck_job", "warning"])
          .contains("payload" as any, {
            spread_type: spread.spread_type,
            invariant: "spread_generating_timeout",
          } as any);

        if ((existingCount ?? 0) > 0) continue;
      }

      writeSystemEvent({
        event_type: "stuck_job",
        severity: isCritical ? "critical" : "warning",
        source_system: "observer",
        deal_id: spread.deal_id,
        bank_id: spread.bank_id,
        error_class: "timeout",
        error_message: `Spread ${spread.spread_type} stuck in "${spread.status}" for ${Math.round(minutesStuck)} minutes${
          healOutcome === "requeued"
            ? " — reset to queued and re-enqueued"
            : healOutcome === "terminal"
              ? ` — gave up after ${MAX_AUTO_HEAL_ATTEMPTS} auto-heal attempts, marked error`
              : ""
        }`,
        // A re-queued spread is NOT resolved — it is being retried, and the
        // finding must stay open so a spread that never converges keeps showing
        // up instead of being closed out every hour.
        resolution_status: healOutcome === "terminal" ? "resolved" : "open",
        ...(healOutcome === "terminal"
          ? {
              resolved_at: new Date().toISOString(),
              resolved_by: "observer",
              resolution_note: `Unrecoverable: still stuck after ${MAX_AUTO_HEAL_ATTEMPTS} auto-heal attempts, status set to error`,
            }
          : {}),
        payload: {
          invariant: "spread_generating_timeout",
          spread_id: spread.id,
          spread_type: spread.spread_type,
          minutes_stuck: Math.round(minutesStuck),
          auto_healed: healOutcome === "requeued",
          heal_outcome: healOutcome,
        },
      }).catch(() => {});
    }

    // Give every reset row a job to be picked up by. enqueueSpreadRecompute
    // creates the deal_spread_jobs row first and merges into an existing active
    // job when there is one, so this is safe to call on every tick and cannot
    // produce duplicate jobs (the deal_spread_jobs_one_active_per_deal partial
    // unique index enforces that too).
    if (requeueByDeal.size > 0) {
      const { enqueueSpreadRecompute } = await import(
        "@/lib/financialSpreads/enqueueSpreadRecompute"
      );

      for (const entry of requeueByDeal.values()) {
        try {
          const res = await enqueueSpreadRecompute({
            dealId: entry.dealId,
            bankId: entry.bankId,
            spreadTypes: Array.from(entry.spreadTypes) as any,
            skipPrereqCheck: true,
            meta: { source: "observer_auto_heal", triggerReason: "spread_generating_timeout" },
          });

          if (!res.ok) {
            errors.push(
              `spread_generating_timeout: re-enqueue failed for deal ${entry.dealId}: ${res.error}`,
            );
          }
        } catch (enqueueErr: any) {
          errors.push(
            `spread_generating_timeout: re-enqueue threw for deal ${entry.dealId}: ${enqueueErr?.message}`,
          );
        }
      }
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
      .in("status", ["queued", "generating"])
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
        (s) => s.status === "generating" || s.status === "queued",
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

/* ------------------------------------------------------------------ */
/*  Section 5: snapshot_recompute_422 (NO_FACTS / LOAN_REQUEST)        */
/* ------------------------------------------------------------------ */

/**
 * Detect deals where snapshot recompute repeatedly fails with 422
 * (SNAPSHOT_BLOCKED: NO_FACTS or LOAN_REQUEST_INCOMPLETE).
 *
 * 2+ failures in 60min → warning event so operators can investigate
 * whether the extraction pipeline is producing facts for this deal.
 */
async function checkSnapshotRepeatedBlockedDeals(
  sb: ReturnType<typeof supabaseAdmin>,
  result: SpreadsIntelligenceResult,
  errors: string[],
): Promise<void> {
  try {
    const windowCutoff = new Date(
      Date.now() - SNAPSHOT_422_WINDOW_MIN * 60_000,
    ).toISOString();

    const { data: recentFailures, error } = await sb
      .from("deal_pipeline_ledger" as any)
      .select("deal_id, bank_id, created_at, meta")
      .eq("event_key", "snapshot.run.failed")
      .gte("created_at", windowCutoff)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      errors.push(`snapshot_recompute_422: ${error.message}`);
      return;
    }

    // Filter to SNAPSHOT_BLOCKED failures (422s) — NO_FACTS or LOAN_REQUEST_INCOMPLETE
    // Exclude SPREADS_IN_PROGRESS (409s) already handled by Sections 3–4
    const blocked422s = ((recentFailures ?? []) as any[]).filter(
      (evt) => {
        const reason = evt.meta?.reason;
        const reasons: string[] = evt.meta?.reasons ?? [];
        return (
          reason !== "SPREADS_IN_PROGRESS" &&
          (reasons.includes("NO_FACTS") || reasons.includes("LOAN_REQUEST_INCOMPLETE") || reason === "NO_FACTS" || reason === "LOAN_REQUEST_INCOMPLETE")
        );
      },
    );

    // Group by deal_id
    const dealFailures = new Map<
      string,
      { bank_id: string; reasons: Set<string>; count: number; latest: string }
    >();
    for (const evt of blocked422s) {
      const existing = dealFailures.get(evt.deal_id);
      const evtReasons: string[] = evt.meta?.reasons ?? (evt.meta?.reason ? [evt.meta.reason] : []);
      if (existing) {
        existing.count++;
        for (const r of evtReasons) existing.reasons.add(r);
        if (evt.created_at > existing.latest) existing.latest = evt.created_at;
      } else {
        dealFailures.set(evt.deal_id, {
          bank_id: evt.bank_id,
          reasons: new Set(evtReasons),
          count: 1,
          latest: evt.created_at,
        });
      }
    }

    // Emit events for deals with repeated failures
    for (const [dealId, info] of dealFailures) {
      if (info.count < SNAPSHOT_422_MIN_FAILURES) continue;

      result.snapshot_recompute_422_deals++;

      const reasonsList = [...info.reasons];
      const hasNoFacts = reasonsList.includes("NO_FACTS");
      const hasLoanIncomplete = reasonsList.includes("LOAN_REQUEST_INCOMPLETE");

      writeSystemEvent({
        event_type: "warning",
        severity: info.count >= 4 ? "error" : "warning",
        source_system: "observer",
        deal_id: dealId,
        bank_id: info.bank_id,
        error_class: hasNoFacts ? "permanent" : "schema",
        error_message: `Snapshot recompute blocked ${info.count}x in ${SNAPSHOT_422_WINDOW_MIN}min: ${reasonsList.join(", ")}`,
        resolution_status: "open",
        payload: {
          invariant: "snapshot_recompute_422",
          failure_count: info.count,
          window_minutes: SNAPSHOT_422_WINDOW_MIN,
          reasons: reasonsList,
          has_no_facts: hasNoFacts,
          has_loan_incomplete: hasLoanIncomplete,
          latest_failure: info.latest,
        },
      }).catch(() => {});
    }
  } catch (err: any) {
    errors.push(`snapshot_recompute_422: ${err.message}`);
  }
}
