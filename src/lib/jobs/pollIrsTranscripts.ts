/**
 * SPEC S4 D-4 — Cloud Run cron entry point (deployment deferred per spec
 * addendum, same judgment boundary as staleSignatureChecker.ts's cron —
 * this library function + its behavior via pollPendingTranscripts/
 * reconcileTranscriptRequest is the mandatory part). Runs every 30 minutes
 * in production; polls pending IRS transcript requests and reconciles any
 * that just came back.
 */

import { pollPendingTranscripts, type IrsPollingSupabaseClient, type IrsPollingVendorClient } from "@/lib/integrations/irsTranscripts/polling";
import { reconcileTranscriptRequest, type IrsReconcilerSupabaseClient } from "@/lib/integrations/irsTranscripts/reconciler";

export type PollIrsTranscriptsSupabaseClient = IrsPollingSupabaseClient & IrsReconcilerSupabaseClient;

export async function pollAndReconcileIrsTranscripts(deps: {
  sb: PollIrsTranscriptsSupabaseClient;
  vendor: IrsPollingVendorClient;
}): Promise<{ polled: number; received: number; expired: number; reconciled: number }> {
  const outcomes = await pollPendingTranscripts({ sb: deps.sb, vendor: deps.vendor });

  const receivedIds = outcomes.filter((o) => o.outcome === "received").map((o) => o.requestId);
  let reconciled = 0;
  for (const id of receivedIds) {
    const result = await reconcileTranscriptRequest(id, { sb: deps.sb });
    if (result.ok) reconciled++;
  }

  return {
    polled: outcomes.length,
    received: receivedIds.length,
    expired: outcomes.filter((o) => o.outcome === "expired").length,
    reconciled,
  };
}
