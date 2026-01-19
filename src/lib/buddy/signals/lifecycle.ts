import "server-only";

import { emitBuddySignalServer } from "@/buddy/emitBuddySignalServer";

export function emitLifecycleSignal(args: {
  dealId: string;
  phase: "intake" | "underwriting" | string;
  state: "initialized" | "unblocked" | string;
  confidence: "high" | "medium" | "low" | string;
  nextUnblock?: string | null;
}) {
  void emitBuddySignalServer({
    type: "deal.lifecycle",
    source: "lib/buddy/signals/lifecycle",
    ts: Date.now(),
    dealId: args.dealId,
    payload: {
      deal_id: args.dealId,
      phase: args.phase,
      state: args.state,
      confidence: args.confidence,
      next_unblock: args.nextUnblock ?? null,
    },
  });
}
