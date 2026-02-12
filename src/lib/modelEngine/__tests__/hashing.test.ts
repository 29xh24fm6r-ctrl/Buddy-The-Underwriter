import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deterministicHash } from "../hashing";

describe("deterministicHash", () => {
  it("produces consistent hash for same input", () => {
    const input = { b: 2, a: 1 };
    const hash1 = deterministicHash(input);
    const hash2 = deterministicHash(input);
    assert.equal(hash1, hash2);
  });

  it("produces same hash regardless of key order", () => {
    const hash1 = deterministicHash({ a: 1, b: 2, c: 3 });
    const hash2 = deterministicHash({ c: 3, a: 1, b: 2 });
    assert.equal(hash1, hash2);
  });

  it("produces different hash for different values", () => {
    const hash1 = deterministicHash({ a: 1 });
    const hash2 = deterministicHash({ a: 2 });
    assert.notEqual(hash1, hash2);
  });

  it("handles nested objects with sorted keys", () => {
    const hash1 = deterministicHash({ outer: { b: 2, a: 1 } });
    const hash2 = deterministicHash({ outer: { a: 1, b: 2 } });
    assert.equal(hash1, hash2);
  });

  it("handles arrays", () => {
    const hash1 = deterministicHash([1, 2, 3]);
    const hash2 = deterministicHash([1, 2, 3]);
    assert.equal(hash1, hash2);
  });

  it("array order matters", () => {
    const hash1 = deterministicHash([1, 2, 3]);
    const hash2 = deterministicHash([3, 2, 1]);
    assert.notEqual(hash1, hash2);
  });

  it("handles null and undefined", () => {
    const hash1 = deterministicHash(null);
    const hash2 = deterministicHash(null);
    assert.equal(hash1, hash2);
  });

  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = deterministicHash("test");
    assert.match(hash, /^[a-f0-9]{64}$/);
  });
});
