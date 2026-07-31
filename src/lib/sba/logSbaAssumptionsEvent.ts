import "server-only";

/**
 * SPEC-ASSUMPTION-CONFIRM-DEADEND-FIX-V1 — writes to
 * buddy_sba_assumptions_events. buddy_sba_assumptions previously had zero
 * audit trail; every failure in the research → present → confirm flow was
 * either console.error'd (server logs, not queryable from data) or fully
 * silent (client-side try/catch with a comment). Best-effort by design —
 * a logging failure must never block the caller's real work.
 */

type SB = { from: (t: string) => any };

export async function logSbaAssumptionsEvent(
  args: {
    dealId: string;
    bankId: string;
    eventType: string;
    detail?: Record<string, unknown>;
  },
  sb: SB,
): Promise<void> {
  try {
    const { error } = await sb.from("buddy_sba_assumptions_events").insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      event_type: args.eventType,
      detail: args.detail ?? {},
    });
    if (error) {
      console.error("[logSbaAssumptionsEvent] insert error:", error.message);
    }
  } catch (err) {
    console.error(
      "[logSbaAssumptionsEvent] failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
