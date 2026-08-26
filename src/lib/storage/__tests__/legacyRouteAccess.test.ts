import test from "node:test";
import assert from "node:assert/strict";

test("parseDealScopedStorageKey accepts canonical deal-scoped keys", async () => {
  const { parseDealScopedStorageKey } = await import("../legacyRouteAccess");
  assert.deepEqual(parseDealScopedStorageKey("deal-123/uploads/file.pdf"), {
    dealId: "deal-123",
    normalizedKey: "deal-123/uploads/file.pdf",
  });
});

test("parseDealScopedStorageKey rejects absolute and traversal keys", async () => {
  const { parseDealScopedStorageKey } = await import("../legacyRouteAccess");
  for (const key of [
    "/deal-123/file.pdf",
    "../other-deal/file.pdf",
    "deal-123/../other-deal/file.pdf",
    "deal-123\\file.pdf",
    "file.pdf",
  ]) {
    assert.equal(parseDealScopedStorageKey(key), null, key);
  }
});

test("clampSignedUrlTtl bounds private URL lifetime", async () => {
  const { clampSignedUrlTtl } = await import("../legacyRouteAccess");
  assert.equal(clampSignedUrlTtl(null), 600);
  assert.equal(clampSignedUrlTtl("invalid"), 600);
  assert.equal(clampSignedUrlTtl("1"), 60);
  assert.equal(clampSignedUrlTtl("120"), 120);
  assert.equal(clampSignedUrlTtl("3600"), 600);
});
