// src/buddy/emitBuddySignal.ts
import type { BuddySignalBase } from "./signals";

const EVENT_NAME = "buddy:signal";

export function emitBuddySignal(input: Omit<BuddySignalBase, "ts"> & { ts?: number }) {
  const signal: BuddySignalBase = {
    ...input,
    ts: input.ts ?? Date.now(),
  };

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: signal }));
    return;
  }

  // Server: write to canonical ledger (best effort, never crash)
  void (async () => {
    try {
      const mod = await import("@/buddy/server/writeBuddySignal");
      await mod.writeBuddySignal(signal);
    } catch {
      // eslint-disable-next-line no-console
      console.debug(`[buddy] ${signal.type}`, {
        source: signal.source,
        dealId: signal.dealId,
        payload: signal.payload,
      });
    }
  })();
}

export function getBuddySignalEventName() {
  return EVENT_NAME;
}
