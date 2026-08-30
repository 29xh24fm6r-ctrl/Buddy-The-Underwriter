import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("GCS signed PUT URLs require generation zero", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src/lib/storage/gcsSignedPutUrl.ts"),
    "utf8",
  );

  assert.match(source, /queryParams:\s*\{ ifGenerationMatch: "0" \}/);
  const signAt = source.indexOf("await file.getSignedUrl(");
  const preconditionAt = source.indexOf('queryParams: { ifGenerationMatch: "0" }');
  assert.ok(signAt >= 0);
  assert.ok(preconditionAt > signAt);
});

test("a precondition retry is delegated to authoritative record verification", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src/lib/uploads/uploadFile.ts"),
    "utf8",
  );

  assert.match(source, /xhr\.status === 412/);
  assert.match(source, /storage_object_already_created: true/);
  assert.match(source, /record[\s\S]*verifies[\s\S]*bytes[\s\S]*rejects[\s\S]*mismatch/);
});
