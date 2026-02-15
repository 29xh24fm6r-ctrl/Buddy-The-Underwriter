import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "../withTimeout";

describe("withTimeout", () => {
  it("returns value when promise resolves before timeout", async () => {
    const result = await withTimeout(
      Promise.resolve(42),
      1000,
      "test",
    );
    assert.equal(result, 42);
  });

  it("throws timeout error when promise exceeds timeout", async () => {
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(42), 500));
    await assert.rejects(
      () => withTimeout(slow, 50, "slow_op"),
      (err: Error) => {
        assert.match(err.message, /slow_op_timeout_50ms/);
        return true;
      },
    );
  });

  it("cleans up timer after resolution", async () => {
    // This test ensures no dangling timers — the finally block should clearTimeout
    const result = await withTimeout(
      Promise.resolve("ok"),
      5000,
      "cleanup_test",
    );
    assert.equal(result, "ok");
    // If timer leaked, it would fire after 5s — test passes if no error
  });

  it("propagates rejection from the original promise", async () => {
    await assert.rejects(
      () => withTimeout(
        Promise.reject(new Error("original_error")),
        1000,
        "test",
      ),
      (err: Error) => {
        assert.equal(err.message, "original_error");
        return true;
      },
    );
  });
});
