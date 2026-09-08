import "server-only";

import type { BuddySignalBase } from "@/buddy/signals";
import { writeBuddySignal } from "@/buddy/server/writeBuddySignal";

/**
 * Server-side signal emission. Signals are telemetry: they must never reject
 * into the caller. Several emitters (the checklist engine among them) call
 * this without awaiting, so a rejection here becomes an unhandled promise
 * rejection that terminates a serverless worker mid-job.
 */
export async function emitBuddySignalServer(signal: BuddySignalBase) {
  try {
    await writeBuddySignal(signal);
  } catch (e: any) {
    console.warn("[emitBuddySignalServer] signal write failed (non-fatal)", {
      type: signal.type,
      source: signal.source,
      dealId: signal.dealId ?? null,
      error: e?.message ?? String(e),
    });
  }
}
