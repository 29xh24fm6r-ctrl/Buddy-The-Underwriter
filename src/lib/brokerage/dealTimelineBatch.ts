/**
 * Phase 14A — Batch latest-event helper for the work queue.
 *
 * Pure logic for /api/brokerage/deals/timeline/latest. Lifted out of the
 * route so it can be unit-tested without instantiating a Next handler.
 *
 * Safety contract (must not regress):
 * - Reads ONLY through getDealTimeline() — never touches source rows
 *   directly. The output is therefore already normalized + redacted.
 * - Caller supplies a list of deal IDs; we dedupe, drop visibly invalid
 *   ones, and cap at MAX_BATCH_DEAL_IDS (50) before doing any work.
 * - Returns one normalized TimelineEvent (or null) per accepted deal ID.
 *   Per-deal errors do not surface secrets or break the rest of the batch.
 */

import { getDealTimeline, type TimelineEvent } from "./dealTimeline";

export const MAX_BATCH_DEAL_IDS = 50;

export type BatchLatestEntry = { dealId: string; event: TimelineEvent | null };

export type BatchLatestResult = {
  requested: number;
  accepted: number;
  truncated: boolean;
  entries: BatchLatestEntry[];
};

type SB = { from: (t: string) => any };

const DEAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function parseDealIdsParam(raw: string | null): { ids: string[]; requested: number; truncated: boolean } {
  if (!raw) return { ids: [], requested: 0, truncated: false };
  const tokens = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const requested = tokens.length;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!DEAL_ID_PATTERN.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_BATCH_DEAL_IDS) break;
  }
  return { ids: out, requested, truncated: requested > out.length || requested > MAX_BATCH_DEAL_IDS };
}

export async function buildBatchLatestTimelineEvents(
  dealIds: string[],
  sb: SB,
): Promise<BatchLatestEntry[]> {
  if (dealIds.length === 0) return [];

  const results = await Promise.all(
    dealIds.map(async (dealId): Promise<BatchLatestEntry> => {
      try {
        const events = await getDealTimeline(dealId, sb, { limit: 1 });
        return { dealId, event: events[0] ?? null };
      } catch {
        return { dealId, event: null };
      }
    }),
  );

  return results;
}

export async function batchLatestTimelineEvents(
  rawDealIds: string | null,
  sb: SB,
): Promise<BatchLatestResult> {
  const { ids, requested, truncated } = parseDealIdsParam(rawDealIds);
  const entries = await buildBatchLatestTimelineEvents(ids, sb);
  return { requested, accepted: ids.length, truncated, entries };
}
