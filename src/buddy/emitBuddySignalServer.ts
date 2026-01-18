import "server-only";

import type { BuddySignalBase } from "@/buddy/signals";
import { writeBuddySignal } from "@/buddy/server/writeBuddySignal";

export async function emitBuddySignalServer(signal: BuddySignalBase) {
  await writeBuddySignal(signal);
}
