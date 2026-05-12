import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

// Stub next/headers so the underlying sessionToken helper can be loaded
// without a real Next.js request context.
require.cache[require.resolve("next/headers")] = {
  id: "next/headers-stub",
  filename: "next/headers-stub",
  loaded: true,
  exports: {
    cookies: async () => ({
      get: () => undefined,
      set: () => {},
    }),
  },
} as any;

const { hashBorrowerSessionToken } =
  require("../session") as typeof import("../session");

test("hashBorrowerSessionToken is deterministic", () => {
  const a = hashBorrowerSessionToken("known-raw-token");
  const b = hashBorrowerSessionToken("known-raw-token");
  assert.equal(a, b);
});

test("hashBorrowerSessionToken returns a 64-char lowercase hex digest", () => {
  const h = hashBorrowerSessionToken("abc");
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("hashBorrowerSessionToken matches SHA-256 of the input", () => {
  // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  assert.equal(
    hashBorrowerSessionToken("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("hashBorrowerSessionToken differs for different inputs", () => {
  const a = hashBorrowerSessionToken("token-1");
  const b = hashBorrowerSessionToken("token-2");
  assert.notEqual(a, b);
});
