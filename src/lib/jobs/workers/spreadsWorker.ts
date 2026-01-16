import "server-only";

import { processNextSpreadJob } from "@/lib/jobs/processors/spreadsProcessor";

export async function runSpreadsWorkerTick(args?: {
  leaseOwner?: string;
  maxJobs?: number;
}) {
  const leaseOwner = args?.leaseOwner ?? `spreads-worker-${Date.now()}`;
  const maxJobs = Math.min(10, Math.max(1, Number(args?.maxJobs ?? 3)));

  const results: any[] = [];

  for (let i = 0; i < maxJobs; i++) {
    const r = await processNextSpreadJob(leaseOwner);
    if (!r.ok) break;
    results.push(r);
  }

  return {
    ok: true as const,
    processed: results.length,
    results,
  };
}
