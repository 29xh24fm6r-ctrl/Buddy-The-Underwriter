import "server-only";

/**
 * Lifecycle cache — shared, invalidatable store for deriveLifecycleState.
 *
 * SPEC-LOAN-REQUEST-JOURNEY-RAIL-STALE-CTA-FIX-1: deriveLifecycleState memoizes its result for 30s to
 * avoid redundant queries on rapid re-renders. That short-lived cache was previously private to
 * deriveLifecycleState.ts, so a mutation elsewhere (e.g. creating/submitting a loan request) could not
 * clear it — the Journey Rail would keep showing the cached "Add Loan Request" blocker for up to 30s
 * even though a fresh derivation would no longer emit `loan_request_missing` (computeBlockers only emits
 * it when loanRequestCount === 0).
 *
 * Extracting the cache here lets the mutation path (src/lib/loanRequests/actions.ts) call
 * invalidateLifecycleCache(dealId) so the very next lifecycle read derives fresh. This never advances
 * the lifecycle stage and never mutates persisted data — it only drops a memoized read.
 *
 * Note: this is a per-process in-memory map (best-effort across warm serverless instances). Invalidation
 * is therefore best-effort by design; the authoritative state is always re-derived from the DB on a miss.
 */

import type { LifecycleState } from "./model";

// Short-lived cache to prevent redundant lifecycle queries on rapid re-renders.
const LIFECYCLE_CACHE_TTL_MS = 30_000; // 30 seconds

type CacheEntry = { expiresAt: number; value: LifecycleState };
const lifecycleCache = new Map<string, CacheEntry>();

/** Return the cached state for a deal if present and unexpired; otherwise null (expired entries are dropped). */
export function getCachedLifecycleState(dealId: string): LifecycleState | null {
  const cached = lifecycleCache.get(dealId);
  if (!cached) return null;
  if (cached.expiresAt > Date.now()) return cached.value;
  lifecycleCache.delete(dealId); // drop expired entry eagerly
  return null;
}

/** Memoize a freshly derived state for a deal (30s TTL). */
export function setCachedLifecycleState(dealId: string, value: LifecycleState): void {
  lifecycleCache.set(dealId, { expiresAt: Date.now() + LIFECYCLE_CACHE_TTL_MS, value });
}

/**
 * Drop the memoized lifecycle state for a deal so the next read derives fresh.
 * Called after mutations that can change derived blockers (e.g. loan request create/update/delete).
 */
export function invalidateLifecycleCache(dealId: string): void {
  if (!dealId) return;
  lifecycleCache.delete(dealId);
}

/** Test-only: clear the entire cache. */
export function __clearLifecycleCacheForTests(): void {
  lifecycleCache.clear();
}
