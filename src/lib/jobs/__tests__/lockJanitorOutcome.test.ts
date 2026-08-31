import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeLockJanitorRpcResults } from "@/lib/jobs/lockJanitorOutcome";

test("summarizeLockJanitorRpcResults returns count-only proof", () => {
  assert.deepEqual(
    summarizeLockJanitorRpcResults(
      [
        { terminated_pid: 123, released_lock_key: 456 },
        { terminated_pid: 124, released_lock_key: -7 },
      ],
      [
        { bundle_id: "bundle-1", deal_id: "deal-1", previous_stage: "SEALING" },
      ],
    ),
    { released: 2, tridentReconciled: 1 },
  );
});

test("summarizeLockJanitorRpcResults accepts proven empty row sets", () => {
  assert.deepEqual(summarizeLockJanitorRpcResults([], []), {
    released: 0,
    tridentReconciled: 0,
  });
});

test("summarizeLockJanitorRpcResults rejects missing RPC row-set evidence", () => {
  assert.throws(
    () => summarizeLockJanitorRpcResults(null, []),
    /lock_janitor_invalid_lock_result/,
  );
  assert.throws(
    () => summarizeLockJanitorRpcResults([], undefined),
    /lock_janitor_invalid_trident_result/,
  );
});

test("summarizeLockJanitorRpcResults rejects malformed advisory-lock rows", () => {
  assert.throws(
    () =>
      summarizeLockJanitorRpcResults(
        [{ terminated_pid: 0, released_lock_key: 1 }],
        [],
      ),
    /lock_janitor_invalid_lock_pid/,
  );
  assert.throws(
    () =>
      summarizeLockJanitorRpcResults(
        [{ terminated_pid: 1, released_lock_key: "1" }],
        [],
      ),
    /lock_janitor_invalid_lock_key/,
  );
});

test("summarizeLockJanitorRpcResults rejects duplicate recovery evidence", () => {
  assert.throws(
    () =>
      summarizeLockJanitorRpcResults(
        [
          { terminated_pid: 1, released_lock_key: 2 },
          { terminated_pid: 1, released_lock_key: 2 },
        ],
        [],
      ),
    /lock_janitor_invalid_lock_duplicate/,
  );
  assert.throws(
    () =>
      summarizeLockJanitorRpcResults([], [
        { bundle_id: "bundle-1", deal_id: "deal-1", previous_stage: null },
        { bundle_id: "bundle-1", deal_id: "deal-2", previous_stage: null },
      ]),
    /lock_janitor_invalid_trident_duplicate/,
  );
});

test("summarizeLockJanitorRpcResults rejects malformed Trident identities and stages", () => {
  assert.throws(
    () =>
      summarizeLockJanitorRpcResults([], [
        { bundle_id: "", deal_id: "deal-1", previous_stage: null },
      ]),
    /lock_janitor_invalid_trident_identity/,
  );
  assert.throws(
    () =>
      summarizeLockJanitorRpcResults([], [
        { bundle_id: "bundle-1", deal_id: "deal-1", previous_stage: "x".repeat(65) },
      ]),
    /lock_janitor_invalid_trident_stage/,
  );
});

test("summarizeLockJanitorRpcResults enforces bounded result sets", () => {
  const locks = Array.from({ length: 10_001 }, (_, index) => ({
    terminated_pid: index + 1,
    released_lock_key: index,
  }));
  assert.throws(
    () => summarizeLockJanitorRpcResults(locks, []),
    /lock_janitor_invalid_lock_result_limit/,
  );
});
