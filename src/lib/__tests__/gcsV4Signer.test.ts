import { test } from "node:test";
import assert from "node:assert/strict";

import { createV4SignedPutUrl } from "@/lib/google/gcsV4Signer";

test("createV4SignedPutUrl builds signed URL", async () => {
  const result = await createV4SignedPutUrl({
    bucket: "test-bucket",
    objectKey: "deals/123/file.pdf",
    contentType: "application/pdf",
    expiresSeconds: 900,
    region: "us-central1",
    serviceAccountEmail: "svc@test.iam.gserviceaccount.com",
    now: new Date("2025-01-01T00:00:00Z"),
    signBlob: async () => new Uint8Array([1, 2, 3, 4]),
  });

  assert.ok(result.url.includes("X-Goog-Algorithm=GOOG4-RSA-SHA256"));
  assert.ok(result.url.includes("X-Goog-Credential="));
  assert.ok(result.url.includes("X-Goog-Date=20250101T000000Z"));
  assert.ok(result.url.includes("X-Goog-Expires=900"));
  assert.ok(result.url.includes("X-Goog-SignedHeaders=content-type%3Bhost"));
  assert.ok(result.url.includes("X-Goog-Signature=01020304"));
  assert.equal(result.headers["Content-Type"], "application/pdf");
});
