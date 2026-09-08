import "server-only";

import { processNextSpreadJob } from "@/lib/jobs/processors/spreadsProcessor";

export async function runSpreadsWorkerTick(args?: {
  leaseOwner?: string;
  maxJobs?: number;
  /** Absolute epoch-ms horizon of the calling invocation (see processSpreadJob). */
  deadlineAt?: number;
}) {
  const leaseOwner = args?.leaseOwner ?? `spreads-worker-${Date.now()}`;
  const maxJobs = Math.min(10, Math.max(1, Number(args?.maxJobs ?? 3)));

  const results: any[] = [];

  for (let i = 0; i < maxJobs; i++) {
    const r = await processNextSpreadJob(leaseOwner, { deadlineAt: args?.deadlineAt });
    if (!r.ok) {
      if ((r as any).idle === true) break;
      return {
        ok: false as const,
        processed: results.length,
        results,
        error: "spread_processing_failed" as const,
      };
    }
    results.push(r);
    // Out of extraction budget — the job re-queued itself for the next tick;
    // do not lease another job in an invocation that is already out of time.
    if ((r as any).requeuedForExtractionBudget === true) break;
  }

  return {
    ok: true as const,
    processed: results.length,
    results,
  };
}
