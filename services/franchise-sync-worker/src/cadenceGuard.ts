import type { Pool } from 'pg';

/** Cloud Scheduler is configured for weekly runs (see franchise-sync-deploy.sh /
 *  docs/runbooks/franchise-sync.md). More than this many runs in the trailing
 *  24h means the schedule is misconfigured (e.g. an every-N-minutes cron)
 *  rather than the intended weekly cadence. */
export const MAX_RUNS_PER_24H = 3;

export type CadenceCheckResult = {
  throttled: boolean;
  runsTrailing24h: number;
};

/** Counts franchise_sync_runs started in the trailing 24h. */
export async function countRunsTrailing24h(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*) FROM franchise_sync_runs WHERE started_at > now() - interval '24 hours'`
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/** Self-throttle: if the trailing-24h run count exceeds MAX_RUNS_PER_24H,
 *  logs a sync_cadence_anomaly event and reports throttled=true so the
 *  caller can skip the sync without touching any franchise/brand data. */
export async function checkCadence(pool: Pool): Promise<CadenceCheckResult> {
  const runsTrailing24h = await countRunsTrailing24h(pool);
  const throttled = runsTrailing24h > MAX_RUNS_PER_24H;
  if (throttled) {
    console.error(
      `[franchise-sync-worker] sync_cadence_anomaly: ${runsTrailing24h} runs in trailing 24h ` +
        `(expected weekly, threshold ${MAX_RUNS_PER_24H}). Throttling this invocation. ` +
        `See docs/runbooks/franchise-sync.md.`
    );
    await pool.query(
      `INSERT INTO buddy_system_events (event_type, severity, source_system, payload)
       VALUES ('sync_cadence_anomaly', 'warning', 'franchise-sync-worker', $1)`,
      [JSON.stringify({ runsTrailing24h, thresholdPerDay: MAX_RUNS_PER_24H })]
    );
  }
  return { throttled, runsTrailing24h };
}
