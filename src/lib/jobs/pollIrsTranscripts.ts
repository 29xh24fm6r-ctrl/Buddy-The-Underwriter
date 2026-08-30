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

export type PollIrsTranscriptFailure = {
  requestId: string;
  reason: "REQUEST_NOT_FOUND" | "NOT_YET_RECEIVED" | "PERSISTENCE_FAILED";
};

export type PollIrsTranscriptsResult = {
  polled: number;
  received: number;
  expired: number;
  reconciled: number;
  failed: number;
  failures: PollIrsTranscriptFailure[];
};

export async function pollAndReconcileIrsTranscripts(deps: {
  sb: PollIrsTranscriptsSupabaseClient;
  vendor: IrsPollingVendorClient;
}): Promise<PollIrsTranscriptsResult> {
  const outcomes = await pollPendingTranscripts({ sb: deps.sb, vendor: deps.vendor });

  const receivedIds = outcomes.filter((o) => o.outcome === "received").map((o) => o.requestId);
  let reconciled = 0;
  const failures: PollIrsTranscriptFailure[] = [];
  for (const id of receivedIds) {
    try {
      const result = await reconcileTranscriptRequest(id, { sb: deps.sb });
      if (result.ok) {
        reconciled++;
      } else {
        failures.push({ requestId: id, reason: result.reason });
      }
    } catch {
      console.error("[pollIrsTranscripts] reconciliation_persistence_failed", { requestId: id });
      failures.push({ requestId: id, reason: "PERSISTENCE_FAILED" });
    }
  }

  return {
    polled: outcomes.length,
    received: receivedIds.length,
    expired: outcomes.filter((o) => o.outcome === "expired").length,
    reconciled,
    failed: failures.length,
    failures,
  };
}
