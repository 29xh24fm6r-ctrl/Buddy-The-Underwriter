/**
 * In-memory chat store for release readiness.
 * Swap to DB later without changing UI contract.
 */
import type { EvidenceRef } from "@/lib/evidence/types";

export type CommitteeMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; citations: EvidenceRef[]; followups?: string[] };

const mem = new Map<string, CommitteeMessage[]>();

export function getThread(dealId: string) {
  return mem.get(dealId) ?? [];
}

export function append(dealId: string, msg: CommitteeMessage) {
  const arr = mem.get(dealId) ?? [];
  mem.set(dealId, [...arr, msg]);
}
