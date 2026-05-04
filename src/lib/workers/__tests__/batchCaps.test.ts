import test from "node:test";
import assert from "node:assert/strict";

import { resolveBatchSize, BATCH_LIMITS } from "../batchCaps";

test("batchCaps: outbox default", () => {
  const n = resolveBatchSize(null, undefined, "outbox");
  assert.equal(n, BATCH_LIMITS.outbox.default);
});

test("batchCaps: ledger default", () => {
  const n = resolveBatchSize(null, undefined, "ledger");
  assert.equal(n, BATCH_LIMITS.ledger.default);
});

test("batchCaps: docExtraction default", () => {
  const n = resolveBatchSize(null, undefined, "docExtraction");
  assert.equal(n, BATCH_LIMITS.docExtraction.default);
});

test("batchCaps: env value overrides default", () => {
  const n = resolveBatchSize(null, "8", "outbox");
  assert.equal(n, 8);
});

test("batchCaps: override (?max=) wins over env", () => {
  const n = resolveBatchSize("3", "20", "outbox");
  assert.equal(n, 3);
});

test("batchCaps: clamps outbox max at 25 (env exceeds)", () => {
  const n = resolveBatchSize(null, "9999", "outbox");
  assert.equal(n, BATCH_LIMITS.outbox.max);
  assert.equal(n, 25);
});

test("batchCaps: clamps ledger max at 50", () => {
  const n = resolveBatchSize("9999", undefined, "ledger");
  assert.equal(n, 50);
});

test("batchCaps: clamps docExtraction max at 10", () => {
  const n = resolveBatchSize("999", undefined, "docExtraction");
  assert.equal(n, 10);
});

test("batchCaps: rejects non-positive override and falls back to default", () => {
  // 0 / negative are considered invalid input — fall through to env (none) then default.
  assert.equal(resolveBatchSize("0", undefined, "outbox"), BATCH_LIMITS.outbox.default);
  assert.equal(resolveBatchSize("-5", undefined, "outbox"), BATCH_LIMITS.outbox.default);
});

test("batchCaps: ignores garbage env value, falls back to default", () => {
  const n = resolveBatchSize(null, "not-a-number", "outbox");
  assert.equal(n, BATCH_LIMITS.outbox.default);
});

test("batchCaps: ignores garbage override, falls back to env", () => {
  const n = resolveBatchSize("garbage", "12", "outbox");
  assert.equal(n, 12);
});
