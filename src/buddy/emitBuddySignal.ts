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
  }
}

export function getBuddySignalEventName() {
  return EVENT_NAME;
}
