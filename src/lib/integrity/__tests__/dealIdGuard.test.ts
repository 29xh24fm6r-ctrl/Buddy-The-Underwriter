import { test } from "node:test";
import assert from "node:assert/strict";

// Import from the pure module — the server-only wrapper is exercised in production
// via fire-and-forget ledger writes. Pure logic owns the contract; tests own pure.
import {
  DealIdMismatchError,
  assertDealIdMatch,
  verifyDealIdMatch,
} from "../dealIdGuardPure";

const DEAL_A = "0d31ebf3-485d-414e-a8ac-9b0e79884944";
const DEAL_B = "11111111-1111-1111-1111-111111111111";

const ctx = (surface = "test/surface") => ({
  surface,
  recordKind: "TestRecord",
  recordId: "rec-1",
});

// ---------------------------------------------------------------------------
// verifyDealIdMatch
// ---------------------------------------------------------------------------

test("verify: same-deal record passes through with narrowed type", () => {
  const record = { id: "rec-1", deal_id: DEAL_A, payload: 42 };
  const result = verifyDealIdMatch(record, DEAL_A, ctx());
  assert.equal(result.ok, true);
  if (result.ok) {
    // Narrowing: deal_id is now string (no longer string | null | undefined)
    assert.equal(result.record.deal_id, DEAL_A);
    assert.equal(result.record.payload, 42);
  }
});

test("verify: mismatch returns failure with both ids and reason='mismatch'", () => {
  const record = { id: "rec-1", deal_id: DEAL_B };
  const result = verifyDealIdMatch(record, DEAL_A, ctx("decision/snapshot"));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "mismatch");
    assert.equal((result as any).expected, DEAL_A);
    assert.equal((result as any).found, DEAL_B);
    assert.equal((result as any).recordId, "rec-1");
    assert.equal(result.ctx.surface, "decision/snapshot");
  }
});

test("verify: null record returns failure with reason='missing'", () => {
  const result = verifyDealIdMatch(null, DEAL_A, ctx());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "missing");
  }
});

test("verify: undefined record returns failure with reason='missing'", () => {
  const result = verifyDealIdMatch(undefined, DEAL_A, ctx());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "missing");
  }
});

test("verify: record with null deal_id treated as 'missing' (no fallback)", () => {
  const record = { id: "rec-1", deal_id: null };
  const result = verifyDealIdMatch(record, DEAL_A, ctx());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "missing");
  }
});

test("verify: record with undefined deal_id treated as 'missing'", () => {
  const record: { id: string; deal_id?: string | null } = { id: "rec-1" };
  const result = verifyDealIdMatch(record, DEAL_A, ctx());
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// assertDealIdMatch
// ---------------------------------------------------------------------------

test("assert: same-deal does not throw", () => {
  const record = { deal_id: DEAL_A };
  assert.doesNotThrow(() => assertDealIdMatch(record, DEAL_A, ctx()));
});

test("assert: mismatch throws DealIdMismatchError with structured fields", () => {
  const record = { id: "rec-1", deal_id: DEAL_B };
  try {
    assertDealIdMatch(record, DEAL_A, ctx("pricing/memo-pdf"));
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof DealIdMismatchError);
    if (err instanceof DealIdMismatchError) {
      assert.equal(err.code, "DATA_INTEGRITY_DEAL_ID_MISMATCH");
      assert.equal(err.expected, DEAL_A);
      assert.equal(err.found, DEAL_B);
      assert.equal(err.recordId, "rec-1");
      assert.equal(err.surface, "pricing/memo-pdf");
      assert.equal(err.recordKind, "TestRecord");
    }
  }
});

test("assert: null record throws DealIdMismatchError (no silent pass)", () => {
  assert.throws(
    () => assertDealIdMatch(null, DEAL_A, ctx()),
    DealIdMismatchError,
  );
});

test("assert: missing deal_id field throws (no fallback to demo data)", () => {
  const record = { id: "rec-1", deal_id: null };
  try {
    assertDealIdMatch(record, DEAL_A, ctx());
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof DealIdMismatchError);
    if (err instanceof DealIdMismatchError) {
      assert.equal(err.found, null);
    }
  }
});

// ---------------------------------------------------------------------------
// Acceptance tests from the spec
// ---------------------------------------------------------------------------

test("acceptance: OmniCare deal cannot accept Snapshot #8821 (cross-deal)", () => {
  // OmniCare = DEAL_A, foreign Snapshot #8821 belongs to DEAL_B
  const foreignSnapshot = {
    id: "snapshot-8821",
    deal_id: DEAL_B,
    decision: "APPROVED",
  };
  const result = verifyDealIdMatch(foreignSnapshot, DEAL_A, {
    surface: "decision/snapshot",
    recordKind: "DecisionSnapshot",
    recordId: "snapshot-8821",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "mismatch");
    assert.equal((result as any).found, DEAL_B);
    assert.equal((result as any).recordId, "snapshot-8821");
  }
});

test("acceptance: missing snapshot returns 'missing' (not silent fallback)", () => {
  const result = verifyDealIdMatch(null, DEAL_A, ctx("decision/snapshot"));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "missing");
  }
});

test("acceptance: valid same-deal snapshot loads cleanly", () => {
  const ownSnapshot = {
    id: "snapshot-7000",
    deal_id: DEAL_A,
    decision: "APPROVED",
  };
  const result = verifyDealIdMatch(ownSnapshot, DEAL_A, ctx());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.record.id, "snapshot-7000");
    assert.equal(result.record.deal_id, DEAL_A);
  }
});

test("acceptance: empty-string deal_id mismatched with valid id is mismatch, not missing", () => {
  // Defensive: an empty string is not a valid deal id but is also not missing.
  // We treat it as a mismatch so it surfaces in the ledger as data drift.
  const record = { id: "rec-1", deal_id: "" };
  const result = verifyDealIdMatch(record as any, DEAL_A, ctx());
  assert.equal(result.ok, false);
});
