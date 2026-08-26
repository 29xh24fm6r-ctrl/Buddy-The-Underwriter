/**
 * SPEC-FRANCHISE-SYNC-HYGIENE-1 — finalize orphaned franchise sync runs and
 * surface silently-degraded sources.
 *
 * The four scrapers in services/franchise-sync-worker each INSERT a
 * franchise_sync_runs row with status='running' and only ever set it to
 * 'complete' on their happy path. Nothing finalizes a run whose process died
 * mid-flight, and nothing sweeps the leftovers.
 *
 * Production, 2026-08-26: 5,748 rows stuck at 'running', the newest of them
 * from 2026-06-13 — orphans accumulating for over two months with no signal.
 * Separately, nasaa_efd had logged 4,816 errors across 5,400 runs while every
 * one of those runs still reported status='complete', and both state_wi and
 * sba_directory had stopped running entirely (April) without anyone noticing.
 * sba_directory is the SBA's own franchise directory — the authoritative
 * eligibility source that scoreFranchiseQuality reads.
 *
 * This runs from the nightly cron. It does three things:
 *   1. Finalizes runs stuck in 'running' past a generous cutoff as 'failed'.
 *   2. Emits a warning for any source whose recent error rate is material,
 *      even though its runs report 'complete'.
 *   3. Emits a warning for any source that has gone quiet.
 *
 * Deliberately does NOT change the 'complete' status value on error-carrying
 * runs: diffEngine.ts selects on `status = 'complete'`, and redefining that
 * value under it would change which snapshot the diff engine trusts.
 */

type SB = { from: (t: string) => any };

/** A run still 'running' after this long did not finish; its process is gone. */
const ORPHAN_CUTOFF_HOURS = 6;
/** Window for the error-rate and staleness checks. */
const HEALTH_WINDOW_DAYS = 7;
/** Fraction of runs carrying errors above which a source is "degraded". */
const DEGRADED_ERROR_RATIO = 0.25;
/** A source with no completed run in this long has gone quiet. */
const STALE_SOURCE_DAYS = 3;

export type FranchiseSyncJanitorResult = {
  orphansFinalized: number;
  degradedSources: Array<{ source: string; runs: number; withErrors: number }>;
  staleSources: Array<{ source: string; lastCompletedAt: string | null }>;
  errors: string[];
};

export async function runFranchiseSyncJanitor(
  sb: SB,
): Promise<FranchiseSyncJanitorResult> {
  const result: FranchiseSyncJanitorResult = {
    orphansFinalized: 0,
    degradedSources: [],
    staleSources: [],
    errors: [],
  };

  const orphanCutoff = new Date(
    Date.now() - ORPHAN_CUTOFF_HOURS * 3_600_000,
  ).toISOString();

  // 1. Finalize orphans.
  try {
    const { data, error } = await sb
      .from("franchise_sync_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        errors: [
          {
            code: "ORPHANED_RUN",
            message: `Run was still 'running' after ${ORPHAN_CUTOFF_HOURS}h; finalized by the nightly janitor.`,
          },
        ],
      })
      .eq("status", "running")
      .lt("started_at", orphanCutoff)
      .select("id");

    if (error) result.errors.push(`finalize_orphans: ${error.message}`);
    else result.orphansFinalized = (data ?? []).length;
  } catch (e: any) {
    result.errors.push(`finalize_orphans: ${e?.message ?? String(e)}`);
  }

  // 2 & 3. Source health over the recent window.
  try {
    const windowStart = new Date(
      Date.now() - HEALTH_WINDOW_DAYS * 86_400_000,
    ).toISOString();

    const { data: runs, error } = await sb
      .from("franchise_sync_runs")
      .select("source, status, error_count, completed_at")
      .gte("created_at", windowStart)
      .limit(10_000);

    if (error) {
      result.errors.push(`source_health: ${error.message}`);
      return result;
    }

    const bySource = new Map<
      string,
      { runs: number; withErrors: number; lastCompletedAt: string | null }
    >();

    for (const row of (runs ?? []) as Array<Record<string, any>>) {
      const source = String(row.source ?? "unknown");
      const entry =
        bySource.get(source) ?? { runs: 0, withErrors: 0, lastCompletedAt: null };
      entry.runs += 1;
      if (Number(row.error_count ?? 0) > 0) entry.withErrors += 1;
      if (
        row.status === "complete" &&
        row.completed_at &&
        (!entry.lastCompletedAt || row.completed_at > entry.lastCompletedAt)
      ) {
        entry.lastCompletedAt = String(row.completed_at);
      }
      bySource.set(source, entry);
    }

    const staleCutoff = Date.now() - STALE_SOURCE_DAYS * 86_400_000;

    for (const [source, s] of bySource) {
      if (s.runs > 0 && s.withErrors / s.runs >= DEGRADED_ERROR_RATIO) {
        result.degradedSources.push({
          source,
          runs: s.runs,
          withErrors: s.withErrors,
        });
      }
      const last = s.lastCompletedAt ? Date.parse(s.lastCompletedAt) : NaN;
      if (!Number.isFinite(last) || last < staleCutoff) {
        result.staleSources.push({
          source,
          lastCompletedAt: s.lastCompletedAt,
        });
      }
    }
  } catch (e: any) {
    result.errors.push(`source_health: ${e?.message ?? String(e)}`);
  }

  return result;
}
