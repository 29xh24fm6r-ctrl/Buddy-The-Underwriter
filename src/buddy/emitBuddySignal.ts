// src/buddy/emitBuddySignal.ts
import type { BuddySignalBase } from "./signals";

const EVENT_NAME = "buddy:signal";

export function emitBuddySignal(input: Omit<BuddySignalBase, "ts"> & { ts?: number }) {
  let runId = input.payload?.runId;
  if (!runId && typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem("buddy.session.v1");
      if (raw) {
        const parsed = JSON.parse(raw) as { runId?: string | null };
        if (typeof parsed?.runId === "string") runId = parsed.runId;
      }
    } catch {
      // ignore
    }
  }

  const payload = {
    ...(input.payload ?? {}),
    kind: input.payload?.kind ?? input.type,
    ...(runId ? { runId } : {}),
  };
  const signal: BuddySignalBase = {
    ...input,
    ts: input.ts ?? Date.now(),
    payload,
  };

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: signal }));

    if (process.env.NEXT_PUBLIC_BUDDY_OBSERVER_MODE === "1") {
      try {
        void fetch("/api/buddy/signals/record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(signal),
          keepalive: true,
        });
      } catch {
        // ignore
      }
    }
  }
}

export function getBuddySignalEventName() {
  return EVENT_NAME;
}
