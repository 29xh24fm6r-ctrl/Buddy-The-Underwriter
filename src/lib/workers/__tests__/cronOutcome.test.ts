import assert from "node:assert/strict";
import test from "node:test";
import { getCronOutcome } from "../cronOutcome";

test("marks a completely successful batch green", () => {
  assert.deepEqual(getCronOutcome(0), {
    ok: true,
    failures: 0,
    status: 200,
  });
});

test("makes partial batch failure visible to the scheduler", () => {
  assert.deepEqual(getCronOutcome(3), {
    ok: false,
    failures: 3,
    status: 500,
  });
});

test("rejects invalid failure counts", () => {
  assert.throws(() => getCronOutcome(-1), /non-negative integer/);
  assert.throws(() => getCronOutcome(1.5), /non-negative integer/);
});
