/**
 * Fast-lane: attempt immediate, non-blocking delivery to Pulse.
 *
 * This is best-effort only. The canonical worker is the real system.
 * Failures NEVER throw. On failure, a degraded signal is emitted.
 *
 * Uses the Pulse MCP client's buddy_event_ingest tool — same path as the
 * worker, but called inline for immediate visibility.
 */

import "server-only";

import { callTool } from "@/lib/pulseMcp/client";

export async function tryForwardToPulse(args: {
  eventId: string;
  kind: string;
  dealId: string;
  bankId?: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    const result = await callTool("buddy_event_ingest", {
      event_id: args.eventId,
      source: "buddy",
      kind: args.kind,
      deal_id: args.dealId,
      bank_id: args.bankId ?? null,
      payload: args.payload,
    });

    if (!result.ok) {
      // Emit degraded signal — non-blocking, best-effort
      emitForwardingFailedSignal(args.eventId, args.dealId, result.error ?? "unknown");
    }
  } catch {
    // swallow — fast lane must never throw
    emitForwardingFailedSignal(args.eventId, args.dealId, "fast_lane_exception");
  }
}

/**
 * Fire-and-forget degraded signal emission.
 * Uses dynamic import to avoid circular dependencies with signal infrastructure.
 */
function emitForwardingFailedSignal(
  eventId: string,
  dealId: string,
  error: string,
): void {
  void (async () => {
    try {
      const { emitBuddySignalServer } = await import("@/buddy/emitBuddySignalServer");
      await emitBuddySignalServer({
        type: "pulse.forwarding_failed" as any,
        source: "fastlane",
        ts: Date.now(),
        dealId,
        payload: {
          event_id: eventId,
          error,
          source: "fastlane",
        },
      });
    } catch {
      // signals must never block — swallow
    }
  })();
}
