export type CronOutcome = {
  ok: boolean;
  failures: number;
  status: 200 | 500;
};

/**
 * Converts batch-level failure evidence into the HTTP contract consumed by
 * Vercel Cron and external schedulers. Partial work remains visible in the
 * route payload, but any real failure must make the invocation non-green.
 */
export function getCronOutcome(failures: number): CronOutcome {
  if (!Number.isSafeInteger(failures) || failures < 0) {
    throw new Error("cron failure count must be a non-negative integer");
  }

  return failures === 0
    ? { ok: true, failures: 0, status: 200 }
    : { ok: false, failures, status: 500 };
}
