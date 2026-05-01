import "server-only";

/**
 * Deal-ID Integrity Guard (P0c) — server-side wrapper.
 *
 * Re-exports the pure verification API from `./dealIdGuardPure` and binds
 * the failure emitter to a fire-and-forget ledger write. Routes / RSC
 * loaders should import from THIS module, not the pure one, so failures
 * are observable in `deal_events`.
 */

import {
  verifyDealIdMatch as verifyDealIdMatchPure,
  assertDealIdMatch as assertDealIdMatchPure,
  DealIdMismatchError,
  type DealIdGuardContext,
  type DealIdGuardFailure,
  type DealIdGuardResult,
} from "./dealIdGuardPure";

export type { DealIdGuardContext, DealIdGuardFailure, DealIdGuardResult };
export { DealIdMismatchError };

/**
 * Fire-and-forget ledger event. Never throws; never blocks the caller.
 * Wrapped in dynamic import so the guard stays usable from contexts that
 * cannot resolve the ledger (early bootstrap, isolated tests).
 */
function emitDealIdMismatchEvent(failure: DealIdGuardFailure): void {
  void (async () => {
    try {
      const { writeEvent } = await import("@/lib/ledger/writeEvent");
      const found = failure.reason === "mismatch" ? failure.found : null;
      const recordId = failure.reason === "mismatch" ? failure.recordId : null;
      await writeEvent({
        dealId: failure.expected,
        kind: "data_integrity.deal_id_mismatch",
        scope: "integrity",
        action: failure.reason,
        requiresHumanReview: true,
        meta: {
          surface: failure.ctx.surface,
          record_kind: failure.ctx.recordKind,
          record_id: recordId ?? failure.ctx.recordId ?? null,
          expected_deal_id: failure.expected,
          found_deal_id: found,
          reason: failure.reason,
        },
      });
    } catch {
      // Ledger unavailable — caller still gets the failure result.
    }
  })();
}

export function verifyDealIdMatch<T extends { deal_id?: string | null }>(
  record: T | null | undefined,
  expectedDealId: string,
  ctx: DealIdGuardContext,
): DealIdGuardResult<T> {
  return verifyDealIdMatchPure(record, expectedDealId, ctx, emitDealIdMismatchEvent);
}

export function assertDealIdMatch<T extends { deal_id?: string | null }>(
  record: T | null | undefined,
  expectedDealId: string,
  ctx: DealIdGuardContext,
): asserts record is T & { deal_id: string } {
  assertDealIdMatchPure(record, expectedDealId, ctx, emitDealIdMismatchEvent);
}
