import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Shim server-only + next/headers + @/lib/supabase/admin before loading the
// module under test. Same pattern as src/lib/__tests__/pipelineClassification.test.ts.
const require = createRequire(import.meta.url);
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") {
    return path.join(process.cwd(), "node_modules/server-only/empty.js");
  }
  return origResolve.call(this, request, ...args);
};

// Stub next/headers and supabaseAdmin via Module cache poisoning.
const nextHeadersStub = {
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
  }),
};
require.cache[require.resolve("next/headers")] = {
  id: "next/headers-stub",
  filename: "next/headers-stub",
  loaded: true,
  exports: nextHeadersStub,
} as any;

const { __test_hashToken } =
  require("../sessionToken") as typeof import("../sessionToken");

// ─── Hash determinism & shape ─────────────────────────────────────────

test("hashToken is deterministic: same input → same output", () => {
  const a = __test_hashToken("abc123");
  const b = __test_hashToken("abc123");
  assert.equal(a, b);
});

test("hashToken is SHA-256: output length is 64 hex chars", () => {
  const h = __test_hashToken("deadbeef");
  assert.equal(h.length, 64);
  assert.match(h, /^[a-f0-9]{64}$/);
});

test("hashToken: different inputs produce different hashes", () => {
  const a = __test_hashToken("token-one");
  const b = __test_hashToken("token-two");
  assert.notEqual(a, b);
});

test("hashToken: matches known SHA-256 vector (empty string)", () => {
  // SHA-256 of "" is the standard test vector.
  assert.equal(
    __test_hashToken(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("hashToken: 32 random bytes hex → 64-char hash (matches prod token shape)", () => {
  // Production generates 32 random bytes and encodes as hex (64 chars).
  const raw = "a".repeat(64);
  const h = __test_hashToken(raw);
  assert.equal(h.length, 64);
  assert.notEqual(h, raw);
});
