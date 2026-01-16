import test from "node:test";
import assert from "node:assert/strict";

test("sanitizeFilename removes separators and collapses whitespace", async () => {
  const { sanitizeFilename } = await import("@/lib/storage/gcsNaming");
  const result = sanitizeFilename("path/to  file   name.pdf");
  assert.equal(result, "path to file name.pdf");
});

test("sanitizeFilename preserves extension with length cap", async () => {
  const { sanitizeFilename } = await import("@/lib/storage/gcsNaming");
  const longName = "a".repeat(200) + ".pdf";
  const result = sanitizeFilename(longName, 120);
  assert.ok(result.length <= 120);
  assert.ok(result.endsWith(".pdf"));
});

test("buildGcsObjectKey uses canonical path", async () => {
  const { buildGcsObjectKey } = await import("@/lib/storage/gcsNaming");
  const key = buildGcsObjectKey({
    bankId: "bank1",
    dealId: "deal1",
    fileId: "file1",
    filename: "Test.pdf",
  });
  assert.equal(key, "banks/bank1/deals/deal1/file1/Test.pdf");
});
