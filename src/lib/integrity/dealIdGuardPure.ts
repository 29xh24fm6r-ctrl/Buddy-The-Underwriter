/**
 * Deal-ID Integrity Guard — pure logic.
 *
 * Pure module — no `server-only`, no DB, no ledger writes. Safe to import
 * from CI guard tests. Side-effect emission lives in `./dealIdGuard.ts`,
 * which re-exports this module's API and adds fire-and-forget ledger writes.
 *
 * Routes/loaders should import from `./dealIdGuard.ts` (not this file
 * directly) so the ledger emission still happens in production.
 */

export type DealIdGuardContext = {
  surface: string;
  recordKind: string;
  recordId?: string | null;
};

export type DealIdGuardFailure =
  | { ok: false; reason: "missing"; expected: string; ctx: DealIdGuardContext }
  | {
      ok: false;
      reason: "mismatch";
      expected: string;
      found: string;
      recordId: string | null;
      ctx: DealIdGuardContext;
    };

export type DealIdGuardResult<T extends { deal_id?: string | null }> =
  | { ok: true; record: T & { deal_id: string } }
  | DealIdGuardFailure;

export class DealIdMismatchError extends Error {
  readonly code = "DATA_INTEGRITY_DEAL_ID_MISMATCH";
  readonly expected: string;
  readonly found: string | null;
  readonly recordId: string | null;
  readonly surface: string;
  readonly recordKind: string;

  constructor(failure: DealIdGuardFailure) {
    const found = failure.reason === "mismatch" ? failure.found : null;
    const recordId = failure.reason === "mismatch" ? failure.recordId : null;
    super(
      `[data_integrity] ${failure.ctx.surface}: expected deal_id=${failure.expected}, ` +
        `${failure.reason === "mismatch" ? `found ${found}` : "record missing deal_id"} ` +
        `(${failure.ctx.recordKind}${recordId ? ` id=${recordId}` : ""})`,
    );
    this.name = "DealIdMismatchError";
    this.expected = failure.expected;
    this.found = found;
    this.recordId = recordId;
    this.surface = failure.ctx.surface;
    this.recordKind = failure.ctx.recordKind;
  }
}

export type DealIdMismatchEmitter = (failure: DealIdGuardFailure) => void;

const NOOP_EMITTER: DealIdMismatchEmitter = () => {};

/**
 * Pure verification. The optional `emitter` is invoked synchronously on
 * failure; production callers in `./dealIdGuard.ts` pass an emitter that
 * fires a fire-and-forget ledger event.
 */
export function verifyDealIdMatch<T extends { deal_id?: string | null }>(
  record: T | null | undefined,
  expectedDealId: string,
  ctx: DealIdGuardContext,
  emit: DealIdMismatchEmitter = NOOP_EMITTER,
): DealIdGuardResult<T> {
  if (record == null || record.deal_id == null) {
    const failure: DealIdGuardFailure = {
      ok: false,
      reason: "missing",
      expected: expectedDealId,
      ctx,
    };
    emit(failure);
    return failure;
  }

  if (record.deal_id !== expectedDealId) {
    const failure: DealIdGuardFailure = {
      ok: false,
      reason: "mismatch",
      expected: expectedDealId,
      found: record.deal_id,
      recordId: ctx.recordId ?? null,
      ctx,
    };
    emit(failure);
    return failure;
  }

  return { ok: true, record: record as T & { deal_id: string } };
}

export function assertDealIdMatch<T extends { deal_id?: string | null }>(
  record: T | null | undefined,
  expectedDealId: string,
  ctx: DealIdGuardContext,
  emit: DealIdMismatchEmitter = NOOP_EMITTER,
): asserts record is T & { deal_id: string } {
  const result = verifyDealIdMatch(record, expectedDealId, ctx, emit);
  if (!result.ok) {
    throw new DealIdMismatchError(result);
  }
}
