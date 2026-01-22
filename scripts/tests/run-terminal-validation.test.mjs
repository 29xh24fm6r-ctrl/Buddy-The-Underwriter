import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV = "test";

const { resolveBase } = await import("./run-terminal-validation.mjs");

test("resolveBase: argv provided wins", () => {
  const result = resolveBase("https://example.com", {
    envBase: "https://env.example.com",
    spawnSyncImpl: () => ({ status: 0, stdout: "https://preview.example.com\n" }),
  });
  assert.equal(result, "https://example.com");
});

test("resolveBase: env used when argv missing", () => {
  const result = resolveBase(null, {
    envBase: "https://env.example.com",
    spawnSyncImpl: () => ({ status: 0, stdout: "https://preview.example.com\n" }),
  });
  assert.equal(result, "https://env.example.com");
});

test("resolveBase: falls back to localhost", () => {
  const result = resolveBase(null, {
    envBase: "",
    spawnSyncImpl: () => ({ status: 1, stdout: "" }),
  });
  assert.equal(result, "http://localhost:3000");
});
