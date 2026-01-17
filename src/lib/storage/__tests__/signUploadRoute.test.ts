import test from "node:test";
import assert from "node:assert/strict";

import { buildGcsSignedUploadResponse } from "@/lib/storage/gcsUploadResponse";

test("gcs sign-upload response shape", () => {
  const result = buildGcsSignedUploadResponse({
    bucket: "test-bucket",
    key: "banks/bank-1/deals/deal-1/file-1/Test.pdf",
    signedUploadUrl: "https://signed.example/upload",
    expiresSeconds: 900,
  });

  assert.equal(result.ok, true);
  assert.equal(result.deduped, false);
  assert.equal(result.bucket, "test-bucket");
  assert.equal(result.key, "banks/bank-1/deals/deal-1/file-1/Test.pdf");
  assert.equal(result.signedUploadUrl, "https://signed.example/upload");
  assert.ok(typeof result.expiresAt === "string");
});
